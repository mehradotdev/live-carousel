import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth, email } from './auth';
const http = httpRouter();
authComponent.registerRoutes(http, createAuth);
http.route({
  path: '/resend-webhook',
  method: 'POST',
  handler: httpAction((ctx, request) => email.handleResendEventWebhook(ctx, request)),
});
export default http;
