export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');

export interface EmailService {
  sendLoginCode(to: string, code: string): Promise<void>;
  /** Sent when a Company Admin invites a Normal User -- see
   * TeamService.invite. Deliberately plain/simple, consistent with
   * sendLoginCode: no separate invite-acceptance token, since the
   * invitee just logs in normally (magic-code or Google) with the
   * invited email and lands straight in their new company. */
  sendTeamInvite(to: string, companyName: string): Promise<void>;
}
