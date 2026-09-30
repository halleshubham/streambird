export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');

export interface EmailService {
  sendLoginCode(to: string, code: string): Promise<void>;
}
