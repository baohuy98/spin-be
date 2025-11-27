import { types as MediasoupTypes } from 'mediasoup';

type DtlsParameters = MediasoupTypes.DtlsParameters;
type RtpCapabilities = MediasoupTypes.RtpCapabilities;
type RtpParameters = MediasoupTypes.RtpParameters;
type MediaKind = MediasoupTypes.MediaKind;

export class GetRouterRtpCapabilitiesDto {
  roomId: string;
}

export class CreateTransportDto {
  roomId: string;
  direction: 'send' | 'recv';
}

export class ConnectTransportDto {
  roomId: string;
  transportId: string;
  dtlsParameters: DtlsParameters;
}

export class ProduceDto {
  roomId: string;
  transportId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
}

export class ConsumeDto {
  roomId: string;
  transportId: string;
  producerId: string;
  rtpCapabilities: RtpCapabilities;
}

export class ResumeConsumerDto {
  roomId: string;
  consumerId: string;
}

export class GetProducersDto {
  roomId: string;
}

export class CloseProducerDto {
  roomId: string;
  producerId: string;
}
