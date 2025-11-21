export class OfferDto {
  roomId: string;
  offer: RTCSessionDescriptionInit;
  to: string;
}

export class AnswerDto {
  roomId: string;
  answer: RTCSessionDescriptionInit;
}

export class IceCandidateDto {
  roomId: string;
  candidate: RTCIceCandidateInit;
  to?: string;
}

export class HostReadyDto {
  roomId: string;
}

export class StopSharingDto {
  roomId: string;
}
