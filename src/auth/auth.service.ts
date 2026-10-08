import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Admin } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async generateToken(admin: Partial<Admin>): Promise<{ accessToken: string; expiresIn: string }> {
    const payload = {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn: '7d',
    };
  }

  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  async comparePasswords(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
