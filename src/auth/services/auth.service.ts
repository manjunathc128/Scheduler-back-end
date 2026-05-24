import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RedisService } from 'src/modules/redis/services/redis.service';
import { User } from '../entities/user.entity';
import { UserSession } from '../entities/usersession.entity';
import { createHash } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LoginDto, RefreshTokenDto, RegisterDto } from '../dto';
import { JwtPayload, AuthResponse } from 'src/common/interfaces';

const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    console.log('came here dto ', dto);

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = this.userRepository.create({
      email: dto.email,
      name: dto.name,
      password: hashedPassword,
      role: 'user',
    });

    await this.userRepository.save(user);

    return this.createSession(user, 'default');
  }

  async login(dto: LoginDto, device: string = 'default'): Promise<AuthResponse> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Email already registered');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.createSession(user, device);
  }

  async logout(userId: string, device: string = 'default', accessToken: string): Promise<void> {
    await this.redisService.deleteRefreshToken(userId, device);

    await this.sessionRepository.update(
      { userId, isActive: true },
      { isActive: false },
    );

    const remainingTtl = this.getAccessTokenRemainingTtl(accessToken);
    if (remainingTtl > 0) {
      await this.redisService.blacklistAccessToken(accessToken, remainingTtl);
    }
  }

  async logoutAll(userId: string, accessToken: string): Promise<void> {
    await this.redisService.deleteAllRefreshTokens(userId);

    await this.sessionRepository.update(
      { userId, isActive: true },
      { isActive: false },
    );

    const remainingTtl = this.getAccessTokenRemainingTtl(accessToken);
    if (remainingTtl > 0) {
      await this.redisService.blacklistAccessToken(accessToken, remainingTtl);
    }
  }

  async refershToken(refreshToken: string, device: string = 'default'): Promise<{ accessToken: string }> {
    const payload = this.verifyRefreshToken(refreshToken);
    const userId = payload.sub;

    const incomingHash = this.hashToken(refreshToken);

    const cachedhash = await this.redisService.getRefreshToken(userId, device);

    if (cachedhash) {
      if (cachedhash !== incomingHash) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return this.issueAccessToken(payload);
    } else {
      const session = await this.sessionRepository.findOne({
        where: { userId, device, refreshTokenHash: incomingHash, isActive: true },
      });

      if (!session) {
        throw new UnauthorizedException('Session not found or inactive');
      }

      if (new Date() > session.refreshTokenExpiresAt) {
        session.isActive = false;
        await this.sessionRepository.save(session);
        throw new UnauthorizedException('Refresh token expired');
      }

      const remainingTtl = Math.floor(
        session.refreshTokenExpiresAt.getTime() - Date.now() / 1000,
      );
      await this.redisService.setRefreshToken(userId, device, incomingHash, remainingTtl);

      session.lastUsedAt = new Date();
      await this.sessionRepository.save(session);
    }

    return this.issueAccessToken(payload);
  }

  private async createSession(user: User, device: string): Promise<AuthResponse> {
    const jwtPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = jwt.sign(
      jwtPayload,
      this.configService.get('JWT_SECRET')!,
      { expiresIn: this.configService.get('JWT_EXPIRES_IN', '1h') },
    );

    const refreshToken = jwt.sign(
      jwtPayload,
      this.configService.get('JWT_REFRESH_SECRET')!,
      { expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d') },
    );

    const tokenHash = this.hashToken(refreshToken);

    await this.sessionRepository.update(
      { userId: user.id, isActive: true },
      { isActive: false },
    );

    const session = this.sessionRepository.create({
      userId: user.id,
      refreshTokenHash: tokenHash,
      device,
      refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
      lastUsedAt: new Date(),
      isActive: true,
    });

    await this.sessionRepository.save(session);

    await this.redisService.setRefreshToken(user.id, device, tokenHash, REFRESH_TOKEN_TTL);

    return {
      userId: user.id,
      accessToken,
      refreshToken,
    };
  }

  private verifyRefreshToken(token: string): JwtPayload {
    try {
      return jwt.verify(
        token,
        this.configService.get<string>('JWT_REFRESH_SECRET')!,
      ) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async issueAccessToken(payload: JwtPayload): Promise<{ accessToken: string }> {
    let jwtPayload: JwtPayload;

    if (payload.sub && payload.email && payload.role) {
      jwtPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
      };
    } else {
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      jwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
      };
    }

    const accessToken = jwt.sign(
      jwtPayload,
      this.configService.get('JWT_SECRET')!,
      { expiresIn: this.configService.get('JWT_EXPIRES_IN', '1h') },
    );

    return { accessToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getAccessTokenRemainingTtl(token: string): number {
    try {
      const decoded = jwt.decode(token) as { exp?: number };
      if (!decoded?.exp) return 0;
      const remaining = decoded.exp - Math.floor(Date.now() / 1000);
      return remaining > 0 ? remaining : 0;
    } catch {
      return 0;
    }
  }
}
