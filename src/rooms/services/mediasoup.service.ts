import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  private readonly webRtcTransportConfig = {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: '172.20.10.3', // Use public IP or set your server IP here for production or undefined for local testing
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
  }

  // count of CPU cores to create equivalent mediasoup workers
  private async createWorkers() {
    const numWorkers = os.cpus().length;
    this.logger.log(`Creating ${numWorkers} mediasoup workers...`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker(this.workerConfig);

      worker.on('died', () => {
        this.logger.error(
          `Worker ${worker.pid} died, exiting in 2 seconds... [pid:${worker.pid}]`,
        );
        setTimeout(() => process.exit(1), 2000);
      });

      this.workers.push(worker);
      this.logger.log(`Worker created [pid:${worker.pid}]`);
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
    const router = await worker.createRouter({ mediaCodecs: this.mediaCodecs });

    this.routers.set(roomId, {
      router,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });

    this.logger.log(`Router created for room: ${roomId} `);
    console.log('routers', this.routers);
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

    this.logger.log(`Available transports: ${Array.from(roomRouter.transports.keys()).join(', ')}`);
    const transport = roomRouter.transports.get(transportId);
    if (!transport) {
      this.logger.warn(`Transport not found: ${transportId}`);
      return null;
    }

    this.logger.log(`Available producers: ${Array.from(roomRouter.producers.keys()).join(', ')}`);
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

  async resumeConsumer(
    roomId: string,
    consumerId: string,
  ): Promise<boolean> {
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
    this.logger.log(`[CLEANUP] 🧹 Starting media cleanup for room ${roomId}, oldSocket ${oldSocketId}`);
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
        this.logger.log(`[CLEANUP] 🚗 Closing transport for reconnected user: ${transportId}`);
        transport.close();
        transportsToDelete.push(transportId);
      }
    });
    transportsToDelete.forEach(id => roomRouter.transports.delete(id));

    // Note: Producers are stored by mediasoup ID, not socket ID
    // We can't easily identify which producers belong to which user
    // So we'll close ALL producers when host reconnects (they'll recreate them)
    if (transportsToDelete.length > 0) {
      roomRouter.producers.forEach((producer, producerId) => {
        this.logger.log(`[CLEANUP] 🎬 Closing producer due to user reconnect: ${producerId}`);
        producer.close();
        closedProducerIds.push(producerId);
      });
      roomRouter.producers.clear();
    }

    this.logger.log(`[CLEANUP] ✅ Cleaned up ${transportsToDelete.length} transports and ${closedProducerIds.length} producers for reconnected user in room ${roomId}`);
    return closedProducerIds;
  }

  closeRoom(roomId: string): void {
    this.logger.log(`[CLOSE-ROOM] 🗑️  Starting room cleanup for ${roomId}`);
    const roomRouter = this.routers.get(roomId);
    if (!roomRouter) {
      this.logger.warn(`[CLOSE-ROOM] ⚠️  Room router not found for ${roomId}`);
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
    this.routers.delete(roomId);

    this.logger.log(`[CLOSE-ROOM] ✅ Room ${roomId} fully closed (consumers: ${consumerCount}, producers: ${producerCount}, transports: ${transportCount})`);
  }
}
