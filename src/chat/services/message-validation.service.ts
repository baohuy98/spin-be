import { Injectable } from '@nestjs/common';

import { profanity } from '@2toad/profanity';
export interface MessageValidation {
  containsProfanity: boolean;
  cleanedMessage: string;
}

@Injectable()
export class MessageValidationService {
  validateMessage(message: string): MessageValidation {
    // Check profanity using bad-words library
    const containsProfanity = profanity.exists(message);
    const cleanedMessage = profanity.censor(message);

    return { containsProfanity, cleanedMessage };
  }
}
