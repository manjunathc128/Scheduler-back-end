import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from '../services/auth.service';
import { RegisterDto, LoginDto } from '../dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.register(registerDto);

    // this.setRefreshTokenCookie(reply, result.refreshToken);

    return { userId: result.userId, accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const device = (request.body as any)?.device || 'default';
    const result = await this.authService.login(loginDto, device);

    // this.setRefreshTokenCookie(reply, result.refreshToken);

    return { userId: result.userId, accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: { refreshToken: string; device?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { refreshToken, device = 'default' } = body;

    const { accessToken } = await this.authService.refershToken(refreshToken, device);

    return { accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const userId = (request as any).user.userId;
    const device = (request.body as any)?.device || 'default';
    const accessToken = request.headers['authorization']?.replace('Bearer ', '')!;

    await this.authService.logout(userId, device, accessToken);

    // this.clearRefreshTokenCookie(reply);

    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const userId = (request as any).user.userId;
    const accessToken = request.headers['authorization']?.replace('Bearer ', '')!;

    await this.authService.logoutAll(userId, accessToken);

    this.clearRefreshTokenCookie(reply);
    console.log('here')
    return { message: 'Logged out from all devices' };
  }
  
  private setRefreshTokenCookie(reply: FastifyReply, refreshToken: string): void {
    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });
  }

  private clearRefreshTokenCookie(reply: FastifyReply): void {
    reply.setCookie('refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: 0,
    });
  }
}
