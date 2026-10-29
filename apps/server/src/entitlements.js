// Purchased terms are immutable; accounts never assigned a plan retain their existing configuration.
export function subscriptionFor(state, user) {
  if (user?.role !== "user") return undefined;
  return state.subscriptions?.findLast((item) => item.user_id === user.id);
}
export function modelAllowed(
  state,
  user,
  model,
  timestamp = new Date().toISOString(),
) {
  const subscription = subscriptionFor(state, user);
  return (
    !subscription ||
    (subscription.expires_at > timestamp &&
      subscription.terms.model_ids.includes(model.id))
  );
}
export function effectiveConcurrency(state, user) {
  return (
    subscriptionFor(state, user)?.terms.max_concurrent_requests ||
    user.max_concurrent_requests ||
    1
  );
}
