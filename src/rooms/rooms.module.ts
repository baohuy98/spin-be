import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { RoomsRepository } from './repositories/rooms.repository';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './services/rooms.service';

@Module({
  imports: [StorageModule],
  providers: [RoomsGateway, RoomsService, RoomsRepository],
  exports: [RoomsService],
})
export class RoomsModule { }
