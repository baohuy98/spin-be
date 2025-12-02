import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mediasoup from 'mediasoup';
import { types as MediasoupTypes } from 'mediasoup';
import * as os from 'os';

type Router = MediasoupTypes.Router;
type WebRtcTransport = MediasoupTypes.WebRtcTransport;
type Producer = MediasoupTypes.Producer;
type Consumer = MediasoupTypes.Consumer;
type RtpCapabilities = MediasoupTypes.RtpCapabilities;
type DtlsParameters = MediasoupTypes.DtlsParameters;
type RtpParameters = MediasoupTypes.RtpParameters;
type MediaKind = MediasoupTypes.MediaKind;
type Worker = MediasoupTypes.Worker;
type RtpCodecCapability = MediasoupTypes.RtpCodecCapability;

interface RoomRouter {
  router: Router;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

@Injectable()
export class MediasoupService implements OnModuleInit {
  private readonly logger = new Logger(MediasoupService.name);
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private routers: Map<string, RoomRouter> = new Map();

  // Auto-scaling configuration (set during createWorkers)
  private minWorkers = 2;
  private maxWorkers = 0;
  private isScaling = false; // Prevent concurrent scaling operations

  // Dynamic resource usage thresholds
  private readonly RESOURCE_USAGE_THRESHOLD = 0.75; // Scale up when resource usage > 75%
  private readonly SCALE_DOWN_THRESHOLD = 0.3; // Scale down when usage < 30%

  // Track worker resource metrics (updated periodically)
  private workerResourceUsage: Map<
    Worker,
    {
      cpuUsage: number; // 0-1 (percentage)
      routerCount: number;
      producerCount: number;
      consumerCount: number;
      lastUpdate: number;
    }
  > = new Map();

  constructor(private readonly configService: ConfigService) {
    // Set the announced IP dynamically from environment variables
    const listenIps = this.webRtcTransportConfig
      .listenIps as MediasoupTypes.TransportListenIp[];
    listenIps[0].announcedIp =
      this.configService.get<string>('MEDIASOUP_ANNOUNCED_IP') || undefined; // Default to undefined for local testing
    this.logger.log(
      `Mediasoup announced IP set to: ${listenIps[0].announcedIp || 'undefined (local testing)'}`,
    );
  }

  // Mediasoup configuration
  private readonly workerConfig: MediasoupTypes.WorkerSettings = {
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
    ] as MediasoupTypes.WorkerLogTag[],
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  };

  private readonly webRtcTransportConfig: MediasoupTypes.WebRtcTransportOptions =
    {
      listenIps: [
        {
          ip: '0.0.0.0',
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

  private readonly mediaCodecs = [
    {
      kind: 'audio' as const,
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: 'video' as const,
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: {
        'x-google-start-bitrate': 1000,
      },
    },
    {
      kind: 'video' as const,
      mimeType: 'video/VP9',
      clockRate: 90000,
      parameters: {
        'profile-id': 2,
        'x-google-start-bitrate': 1000,
      },
    },
    {
      kind: 'video' as const,
      mimeType: 'video/h264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '4d0032',
        'level-asymmetry-allowed': 1,
        'x-google-start-bitrate': 1000,
      },
    },
    {
      kind: 'video' as const,
      mimeType: 'video/h264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'level-asymmetry-allowed': 1,
        'x-google-start-bitrate': 1000,
      },
    },
  ] as RtpCodecCapability[];

  async onModuleInit() {
    await this.createWorkers();
    this.startMonitoring();
  }

  private async createWorkers() {
    const cpuCount = os.cpus().length;
    this.maxWorkers = cpuCount;
    this.minWorkers = Math.min(2, this.maxWorkers);

    const workerPromises = Array.from({ length: this.minWorkers }, (_, index) =>
      this.createSingleWorker(index),
    );
    try {
      const workers = await Promise.allSettled(workerPromises);

      workers.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          this.workers.push(result.value);
        } else {
          this.logger.error(
            `Failed to create worker ${index}: ${result.status === 'rejected' ? result.reason : 'Unknown error'}`,
          );
        }
      });

      if (this.workers.length === 0) {
        throw new Error('Failed to create any mediasoup workers');
      }
    } catch (error) {
      this.logger.error('Critical error during worker creation:', error);
      throw error;
    }
  }

  private async createSingleWorker(index: number): Promise<Worker> {
    const worker = await mediasoup.createWorker(this.workerConfig);

    worker.on('died', () => {
      this.logger.error(
        `Worker ${index} died unexpectedly [pid:${worker.pid}]. Attempting recovery...`,
      );

      const workerIndex = this.workers.indexOf(worker);
      if (workerIndex !== -1) {
        this.workers.splice(workerIndex, 1);
      }

      this.recoverWorker(index).catch((error) => {
        this.logger.error(`Failed to recover worker ${index}:`, error);

        if (this.workers.length === 0) {
          this.logger.error(
            'No workers available. Shutting down in 5 seconds...',
          );
          setTimeout(() => process.exit(1), 5000);
        }
      });
    });

    return worker;
  }

  private async recoverWorker(index: number): Promise<void> {
    try {
      this.logger.log(`Attempting to recover worker ${index}...`);
      const newWorker = await this.createSingleWorker(index);
      this.workers.push(newWorker);
      this.logger.log(
        `Worker ${index} recovered successfully [pid:${newWorker.pid}]`,
      );
    } catch (error) {
      this.logger.error(`Worker ${index} recovery failed:`, error);
      throw error;
    }
  }
  private startMonitoring() {
    setInterval(() => {
      const stats = {
        totalWorkers: this.workers.length,
        totalRooms: this.routers.size,
        totalTransports: 0,
        totalProducers: 0,
        totalConsumers: 0,
        avgRoutersPerWorker:
          this.workers.length > 0
            ? (this.routers.size / this.workers.length).toFixed(2)
            : 0,
      };

      this.routers.forEach((roomRouter) => {
        stats.totalTransports += roomRouter.transports.size;
        stats.totalProducers += roomRouter.producers.size;
        stats.totalConsumers += roomRouter.consumers.size;
      });

      this.logger.log(`📊 Stats: ${JSON.stringify(stats)}`);

      // ⚠️ Warning if nearing capacity
      if (stats.totalConsumers > 30) {
        this.logger.warn('⚠️ Nearing capacity: 30+ consumers');
      }
    }, 30000); // Log every 30 seconds
  }

  /**
   * Update worker resource usage metrics from mediasoup worker stats
   */
  private async updateWorkerResourceMetrics() {
    const updatePromises = this.workers.map(async (worker) => {
      try {
        // Get real-time resource usage from mediasoup worker
        const resourceUsage = await worker.getResourceUsage();

        // Count routers, producers, consumers for this worker
        let routerCount = 0;
        let producerCount = 0;
        let consumerCount = 0;

        this.routers.forEach((roomRouter) => {
          // Check if this router belongs to this worker
          if (roomRouter.router.appData.workerId === worker.pid) {
            routerCount++;
            producerCount += roomRouter.producers.size;
            consumerCount += roomRouter.consumers.size;
          }
        });

        // Calculate CPU usage percentage (ru_utime + ru_stime in microseconds)
        const cpuUsage =
          (resourceUsage.ru_utime + resourceUsage.ru_stime) / 1000000; // Convert to seconds

        this.workerResourceUsage.set(worker, {
          cpuUsage: Math.min(cpuUsage, 1.0), // Normalize to 0-1
          routerCount,
          producerCount,
          consumerCount,
          lastUpdate: Date.now(),
        });
      } catch (error) {
        this.logger.error(
          `Failed to get resource usage for worker ${worker.pid}:`,
          error,
        );
      }
    });

    await Promise.allSettled(updatePromises);
  }

  /**
   * Calculate resource usage across all workers
   */
  private calculateResourceUsage(): {
    maxCpuUsage: number;
    avgCpuUsage: number;
    maxProducersPerWorker: number;
    maxConsumersPerWorker: number;
    totalProducers: number;
    totalConsumers: number;
  } {
    let totalCpu = 0;
    let maxCpu = 0;
    let totalProducers = 0;
    let totalConsumers = 0;
    let maxProducers = 0;
    let maxConsumers = 0;

    this.workerResourceUsage.forEach((usage) => {
      totalCpu += usage.cpuUsage;
      maxCpu = Math.max(maxCpu, usage.cpuUsage);
      totalProducers += usage.producerCount;
      totalConsumers += usage.consumerCount;
      maxProducers = Math.max(maxProducers, usage.producerCount);
      maxConsumers = Math.max(maxConsumers, usage.consumerCount);
    });

    return {
      maxCpuUsage: maxCpu,
      avgCpuUsage:
        this.workers.length > 0 ? totalCpu / this.workers.length : 0,
      maxProducersPerWorker: maxProducers,
      maxConsumersPerWorker: maxConsumers,
      totalProducers,
      totalConsumers,
    };
  }

  /**
   * Event-driven auto-scaling based on REAL worker resource usage
   * - Uses mediasoup's getResourceUsage() for actual CPU metrics
   * - Monitors real producer/consumer load per worker
   * - Scales based on measured capacity, not arbitrary limits
   */
  private async checkAndScale() {
    // Prevent concurrent scaling
    if (this.isScaling) {
      this.logger.debug('[AUTO-SCALE] Scaling already in progress, skipping');
      return;
    }

    this.isScaling = true;

    try {
      const currentWorkerCount = this.workers.length;
      const routerCount = this.routers.size;

      // Skip if no routers exist
      if (routerCount === 0) {
        return;
      }

      // Update real-time resource metrics from workers
      await this.updateWorkerResourceMetrics();

      // Calculate resource usage
      const usage = this.calculateResourceUsage();

      this.logger.debug(
        `[AUTO-SCALE] Workers: ${currentWorkerCount}, Routers: ${routerCount}, ` +
        `CPU: max=${(usage.maxCpuUsage * 100).toFixed(1)}%, avg=${(usage.avgCpuUsage * 100).toFixed(1)}%, ` +
        `Producers: total=${usage.totalProducers}, max/worker=${usage.maxProducersPerWorker}, ` +
        `Consumers: total=${usage.totalConsumers}, max/worker=${usage.maxConsumersPerWorker}`,
      );

      // SCALE UP: Check if any worker is approaching capacity
      const shouldScaleUp = usage.maxCpuUsage > this.RESOURCE_USAGE_THRESHOLD;

      if (shouldScaleUp && currentWorkerCount < this.maxWorkers) {
        const reasons: string[] = [];
        if (usage.maxCpuUsage > this.RESOURCE_USAGE_THRESHOLD)
          reasons.push(
            `CPU: ${(usage.maxCpuUsage * 100).toFixed(1)}% > ${this.RESOURCE_USAGE_THRESHOLD * 100}%`,
          );

        this.logger.log(`[AUTO-SCALE] ⬆️  Scaling UP (${reasons.join(', ')})`);
        const newWorker = await this.createSingleWorker(currentWorkerCount);
        this.workers.push(newWorker);
        this.workerResourceUsage.set(newWorker, {
          cpuUsage: 0,
          routerCount: 0,
          producerCount: 0,
          consumerCount: 0,
          lastUpdate: Date.now(),
        });
        this.logger.log(
          `[AUTO-SCALE] ✅ Worker added [pid:${newWorker.pid}]. Total: ${this.workers.length}`,
        );
      }

      // SCALE DOWN: Remove worker if all workers are significantly underutilized
      else if (
        currentWorkerCount > this.minWorkers &&
        usage.avgCpuUsage < this.SCALE_DOWN_THRESHOLD
      ) {
        const workerToRemove = this.workers.pop();
        if (workerToRemove) {
          this.logger.log(
            `[AUTO-SCALE] ⬇️  Scaling DOWN (low CPU usage: ${(usage.avgCpuUsage * 100).toFixed(1)}% < ${this.SCALE_DOWN_THRESHOLD * 100}%)`,
          );
          this.workerResourceUsage.delete(workerToRemove);
          workerToRemove.close();
          this.logger.log(
            `[AUTO-SCALE] ✅ Worker removed. Total: ${this.workers.length}`,
          );
        }
      }
    } catch (error) {
      this.logger.error('[AUTO-SCALE] Scaling operation failed:', error);
    } finally {
      this.isScaling = false;
    }
  }
  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  async createRouter(roomId: string): Promise<Router> {
    const existingRouter = this.routers.get(roomId);
    if (existingRouter) {
      this.logger.log(`Router already exists for room: ${roomId}`);
      return existingRouter.router;
    }

    const worker = this.getNextWorker();
    const router = await worker.createRouter({
      mediaCodecs: this.mediaCodecs,
      appData: { workerId: worker.pid }, // Track which worker owns this router
    });

    this.routers.set(roomId, {
      router,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });

    this.logger.log(`Router created for room: ${roomId} `);
    console.log('routers', this.routers);

    // Trigger immediate auto-scaling check
    void this.checkAndScale();

    return router;
  }

  getRouterRtpCapabilities(roomId: string): RtpCapabilities | null {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`Router not found for room: ${roomId}`);
      return null;
    }
    return roomRouter.router.rtpCapabilities;
  }

  async createWebRtcTransport(
    roomId: string,
    transportId: string,
  ): Promise<{
    id: string;
    iceParameters: any;
    iceCandidates: any[];
    dtlsParameters: any;
  } | null> {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`Router not found for room: ${roomId}`);
      return null;
    }

    const transport = await roomRouter.router.createWebRtcTransport(
      this.webRtcTransportConfig,
    );

    roomRouter.transports.set(transportId, transport);

    this.logger.log(
      `WebRTC transport created [roomId:${roomId}, transportId:${transportId}]`,
    );

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    roomId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<boolean> {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`Router not found for room: ${roomId}`);
      return false;
    }

    const transport = roomRouter.transports.get(transportId);
    if (!transport) {
      this.logger.warn(`Transport not found: ${transportId}`);
      return false;
    }

    await transport.connect({ dtlsParameters });
    this.logger.log(`Transport connected [transportId:${transportId}]`);
    return true;
  }

  async produce(
    roomId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ): Promise<string | null> {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`Router not found for room: ${roomId}`);
      return null;
    }

    const transport = roomRouter.transports.get(transportId);
    if (!transport) {
      this.logger.warn(`Transport not found: ${transportId}`);
      return null;
    }

    const producer = await transport.produce({ kind, rtpParameters });
    // Store by the mediasoup producer ID, not the custom ID
    roomRouter.producers.set(producer.id, producer);

    this.logger.log(
      `Producer created [roomId:${roomId}, kind:${kind}, producerId:${producer.id}]`,
    );

    return producer.id;
  }

  async consume(
    roomId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<{
    id: string;
    producerId: string;
    kind: MediaKind;
    rtpParameters: RtpParameters;
  } | null> {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`Router not found for room: ${roomId}`);
      return null;
    }

    this.logger.log(
      `Available transports: ${Array.from(roomRouter.transports.keys()).join(', ')}`,
    );
    const transport = roomRouter.transports.get(transportId);
    if (!transport) {
      this.logger.warn(`Transport not found: ${transportId}`);
      return null;
    }

    this.logger.log(
      `Available producers: ${Array.from(roomRouter.producers.keys()).join(', ')}`,
    );
    const producer = roomRouter.producers.get(producerId);
    if (!producer) {
      this.logger.warn(`Producer not found: ${producerId}`);
      return null;
    }

    if (
      !roomRouter.router.canConsume({
        producerId: producer.id,
        rtpCapabilities,
      })
    ) {
      this.logger.warn('Cannot consume');
      return null;
    }

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: false,
    });

    // Store by the mediasoup consumer ID, not a custom ID
    roomRouter.consumers.set(consumer.id, consumer);

    this.logger.log(
      `Consumer created [roomId:${roomId}, kind:${consumer.kind}, consumerId:${consumer.id}]`,
    );

    return {
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(roomId: string, consumerId: string): Promise<boolean> {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`Router not found for room: ${roomId}`);
      return false;
    }

    const consumer = roomRouter.consumers.get(consumerId);
    if (!consumer) {
      this.logger.warn(`Consumer not found: ${consumerId}`);
      return false;
    }

    await consumer.resume();
    this.logger.log(`Consumer resumed [consumerId:${consumerId}]`);
    return true;
  }

  getProducers(roomId: string): string[] {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      return [];
    }
    return Array.from(roomRouter.producers.keys());
  }

  closeProducer(roomId: string, producerId: string): void {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) return;

    const producer = roomRouter.producers.get(producerId);
    if (producer) {
      producer.close();
      roomRouter.producers.delete(producerId);
      this.logger.log(`Producer closed [producerId:${producerId}]`);
    }
  }

  closeTransport(roomId: string, transportId: string): void {
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) return;

    const transport = roomRouter.transports.get(transportId);
    if (transport) {
      transport.close();
      roomRouter.transports.delete(transportId);
      this.logger.log(`Transport closed [transportId:${transportId}]`);
    }
  }

  cleanupUserMedia(roomId: string, oldSocketId: string): string[] {
    this.logger.log(
      `[CLEANUP] 🧹 Starting media cleanup for room ${roomId}, oldSocket ${oldSocketId}`,
    );
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`[CLEANUP] ⚠️  Room router not found for ${roomId}`);
      return [];
    }

    const closedProducerIds: string[] = [];

    // Find and close all transports for this old socket
    const transportsToDelete: string[] = [];
    roomRouter.transports.forEach((transport, transportId) => {
      if (transportId.startsWith(oldSocketId)) {
        this.logger.log(
          `[CLEANUP] 🚗 Closing transport for reconnected user: ${transportId}`,
        );
        transport.close();
        transportsToDelete.push(transportId);
      }
    });
    transportsToDelete.forEach((id) => roomRouter.transports.delete(id));

    // Note: Producers are stored by mediasoup ID, not socket ID
    // We can't easily identify which producers belong to which user
    // So we'll close ALL producers when host reconnects (they'll recreate them)
    if (transportsToDelete.length > 0) {
      roomRouter.producers.forEach((producer, producerId) => {
        this.logger.log(
          `[CLEANUP] 🎬 Closing producer due to user reconnect: ${producerId}`,
        );
        producer.close();
        closedProducerIds.push(producerId);
      });
      roomRouter.producers.clear();
    }

    this.logger.log(
      `[CLEANUP] ✅ Cleaned up ${transportsToDelete.length} transports and ${closedProducerIds.length} producers for reconnected user in room ${roomId}`,
    );
    return closedProducerIds;
  }

  closeRoom(roomId: string): void {
    this.logger.log(
      `[CLOSE-ROOM] 🗑️  Starting room cleanup for ${roomId}. Current total rooms: ${this.routers.size}`,
    );
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(
        `[CLOSE-ROOM] ⚠️  Room router not found for ${roomId}. Available rooms: ${Array.from(this.routers.keys()).join(', ') || 'none'}`,
      );
      return;
    }

    const consumerCount = roomRouter.consumers.size;
    const producerCount = roomRouter.producers.size;
    const transportCount = roomRouter.transports.size;

    // Close all consumers
    roomRouter.consumers.forEach((consumer) => consumer.close());
    roomRouter.consumers.clear();
    this.logger.log(`[CLOSE-ROOM] 🎧 Closed ${consumerCount} consumers`);

    // Close all producers
    roomRouter.producers.forEach((producer) => producer.close());
    roomRouter.producers.clear();
    this.logger.log(`[CLOSE-ROOM] 🎬 Closed ${producerCount} producers`);

    // Close all transports
    roomRouter.transports.forEach((transport) => transport.close());
    roomRouter.transports.clear();
    this.logger.log(`[CLOSE-ROOM] 🚗 Closed ${transportCount} transports`);

    // Close router
    roomRouter.router.close();
    const deleted = this.routers.delete(roomId);

    this.logger.log(
      `[CLOSE-ROOM] ✅ Room ${roomId} ${deleted ? 'successfully deleted' : 'FAILED TO DELETE'} (consumers: ${consumerCount}, producers: ${producerCount}, transports: ${transportCount}). Remaining rooms: ${this.routers.size}`,
    );

    // Trigger immediate auto-scaling check (scale down if needed)
    void this.checkAndScale();
  }
}
