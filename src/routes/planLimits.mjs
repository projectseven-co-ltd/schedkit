// planLimits.mjs — plan enforcement for SchedKit
// Plans: free / starter / agency / enterprise

export const PLAN_LIMITS = {
  free: {
    event_types: 3,
    orgs: 0,
    teams_per_org: 0,
    team_members: 0,
    bookings_per_month: 50,
  },
  starter: {
    event_types: 10,
    orgs: 0,
    teams_per_org: 0,
    team_members: 0,
    bookings_per_month: Infinity,
  },
  agency: {
    event_types: Infinity,
    orgs: 1,
    teams_per_org: 5,
    team_members: 25,
    bookings_per_month: Infinity,
  },
  enterprise: {
    event_types: Infinity,
    orgs: Infinity,
    teams_per_org: Infinity,
    team_members: Infinity,
    bookings_per_month: Infinity,
  },
};

export function getLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export function planError(feature, limit, current) {
  const planNames = { free: 'Free', starter: 'Starter', agency: 'Agency', enterprise: 'Enterprise' };
  return {
    statusCode: 403,
    error: 'Plan limit reached',
    message: `Your plan allows ${limit} ${feature}. You have ${current}. Upgrade to unlock more.`,
    upgrade_url: 'https://schedkit.net/#pricing',
  };
}
