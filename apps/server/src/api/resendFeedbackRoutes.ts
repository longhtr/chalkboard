/** Exposes the signed Resend webhook endpoint without logging provider payloads. */
import type { FastifyInstance } from 'fastify';

import type { EmailFeedbackService } from '../email/feedback.js';
import {
  parseResendFeedbackDetailed,
  ResendFeedbackBoundaryError,
  type ResendWebhookVerifier,
} from '../email/resendFeedback.js';
import {
  isErrorInstance,
  logOperationalError,
} from '../operations/errorDiagnostics.js';

export function installResendFeedbackRoutes(
  app: FastifyInstance,
  options: {
    feedback: EmailFeedbackService;
    verifier: ResendWebhookVerifier;
  },
): void {
  // Registered in its own encapsulation so the raw-body parser applies to this
  // route alone. The signature covers exact bytes, so a parsed and reserialized
  // body could never be verified.
  void app.register(async (instance) => {
    // The exact content type must be used: Fastify matches string parsers
    // before regular expressions, so a pattern would lose to the inherited
    // JSON parser and the signed bytes would already have been destroyed.
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    instance.post('/api/email-feedback/resend', async (request, reply) => {
      let parsed: ReturnType<typeof parseResendFeedbackDetailed>;
      try {
        parsed = parseResendFeedbackDetailed(
          options.verifier.verify({
            body: request.body,
            headers: request.headers,
          }),
        );
      } catch (error) {
        const boundaryError = isErrorInstance(
          error,
          ResendFeedbackBoundaryError,
        )
          ? error
          : null;
        if (boundaryError === null) {
          logOperationalError(
            request.log,
            'account-email.resend-feedback-verification.unclassified',
            error,
          );
          return reply.code(503).send({
            error: 'Feedback verification is unavailable.',
            requestId: request.id,
          });
        }
        if (boundaryError.retryable) {
          request.log.error(
            {
              requestId: request.id,
              resendFeedbackFailure: boundaryError.diagnostic(),
            },
            'Resend feedback verification failed',
          );
          return reply.code(503).send({
            error: 'Feedback verification is unavailable.',
            requestId: request.id,
          });
        }
        request.log.warn(
          {
            emailFeedbackRejection: {
              diagnostic: boundaryError.diagnostic(),
              requestId: request.id,
            },
          },
          'Rejected email feedback',
        );
        return reply
          .code(400)
          .send({ error: 'Invalid feedback notification.' });
      }

      const event = parsed.event;
      if (event === null) {
        request.log.info(
          { ignoredResendFeedback: parsed.diagnostic, requestId: request.id },
          'Ignored unsupported authenticated Resend feedback event',
        );
        return reply.code(204).send();
      }

      try {
        const result = await options.feedback.process(event);
        request.log.info(
          {
            emailFeedbackOutcome: result.outcome,
            emailFeedbackType: event.eventType,
            resendEventType: parsed.diagnostic.eventType,
          },
          'Processed authenticated email feedback',
        );
        return reply.code(204).send();
      } catch (error) {
        logOperationalError(
          request.log,
          'account-email.feedback-processing',
          error,
        );
        return reply.code(503).send({
          error: 'Feedback processing is unavailable.',
          requestId: request.id,
        });
      }
    });
  });
}
