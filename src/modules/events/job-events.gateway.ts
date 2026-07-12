import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { JobEventsService } from './job-events.service';
import { RedisService } from '../redis/services/redis.service';
import { JwtPayload } from 'src/common/interfaces';

@WebSocketGateway({
  cors: {
    origin: '*', // tighten in production
    credentials: true,
  },
  namespace: '/jobs',
})
export class JobEventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobEventsGateway.name);

  constructor(
    private readonly jobEventsService: JobEventsService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(server: Server): void {
    // Give the JobEventsService a reference to the server
    this.jobEventsService.setServer(server);
    this.logger.log('WebSocket gateway initialized on namespace /jobs');
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.headers?.authorization as string)?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Socket ${socket.id} rejected — no token`);
        socket.disconnect();
        return;
      }

      // 1. Check blacklist
      const isBlacklisted = await this.redisService.isAccessTokenBlacklisted(token);
      if (isBlacklisted) {
        this.logger.warn(`Socket ${socket.id} rejected — blacklisted token`);
        socket.disconnect();
        return;
      }

      // 2. Verify JWT signature
      const payload = jwt.verify(
        token,
        this.configService.get<string>('JWT_SECRET')!,
      ) as JwtPayload;

      const ownerId = payload.sub;

      // 3. Join user-specific room
      await socket.join(`user_${ownerId}`);

      // Attach ownerId to socket for disconnect logging
      (socket as any).ownerId = ownerId;

      this.logger.log(`Socket ${socket.id} connected — joined room user_${ownerId}`);

      // Confirm to client
      socket.emit('connected', { ownerId, message: 'Subscribed to job events' });
    } catch {
      this.logger.warn(`Socket ${socket.id} rejected — invalid token`);
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket): void {
    const ownerId = (socket as any).ownerId ?? 'unknown';
    this.logger.log(`Socket ${socket.id} disconnected (user: ${ownerId})`);
  }
}
