import { Module } from '@nestjs/common';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './services/rooms.service';
import { RoomsRepository } from './repositories/rooms.repository';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [RoomsGateway, RoomsService, RoomsRepository],
  exports: [RoomsService],
})
export class RoomsModule {}
