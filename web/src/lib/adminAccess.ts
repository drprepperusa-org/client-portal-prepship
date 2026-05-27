const ADMIN_EMAIL = 'admin@drprepper.com';

export function isPrepShipAdminEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === ADMIN_EMAIL;
}

export function adminOnlyEmail() {
  return ADMIN_EMAIL;
}
