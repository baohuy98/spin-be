import { Module } from '@nestjs/common';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './services/rooms.service';
import { RoomsRepository } from './repositories/rooms.repository';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  providers: [RoomsGateway, RoomsService, RoomsRepository],
  exports: [RoomsService],
})
export class RoomsModule {}
