/** Exposes the authenticated SES-over-SNS feedback endpoint without logging provider payloads. */
import type { FastifyInstance } from 'fastify';

import type { EmailFeedbackService } from '../email/feedback.js';
import {
  isErrorInstance,
  logOperationalError,
} from '../operations/errorDiagnostics.js';
import {
  parseSesFeedbackDetailed,
  SesFeedbackPayloadError,
  SnsFeedbackBoundaryError,
  type SnsEnvelopeVerifier,
  type SnsFeedbackFailureDiagnostic,
} from '../email/snsFeedback.js';

export function installEmailFeedbackRoutes(
  app: FastifyInstance,
  options: {
    confirmSubscription?(
      envelope: Awaited<ReturnType<SnsEnvelopeVerifier['verify']>>,
    ): Promise<SnsFeedbackFailureDiagnostic | void>;
    feedback: EmailFeedbackService;
    verifier: SnsEnvelopeVerifier;
  },
): void {
  app.post('/api/email-feedback/ses', async (request, reply) => {
    let envelope: Awaited<ReturnType<SnsEnvelopeVerifier['verify']>>;
    try {
      envelope = await options.verifier.verify(request.body);
    } catch (error) {
      const boundaryError = isErrorInstance(error, SnsFeedbackBoundaryError)
        ? error
        : null;
      if (boundaryError === null || boundaryError.retryable) {
        if (boundaryError === null) {
          logOperationalError(
            request.log,
            'account-email.feedback-verification.unclassified',
            error,
          );
        } else {
          request.log.error(
            {
              snsFeedbackFailure: boundaryError.diagnostic(),
              requestId: request.id,
            },
            'SNS feedback verification failed',
          );
        }
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
      return reply.code(400).send({ error: 'Invalid feedback notification.' });
    }

    if (envelope.Type !== 'Notification') {
      if (
        envelope.Type === 'SubscriptionConfirmation' &&
        options.confirmSubscription !== undefined
      ) {
        try {
          const diagnostic = await options.confirmSubscription(envelope);
          if (diagnostic !== undefined) {
            request.log.info(
              {
                requestId: request.id,
                snsSubscriptionConfirmation: diagnostic,
              },
              'Confirmed SNS feedback subscription',
            );
          }
          return reply.code(204).send();
        } catch (error) {
          const boundaryError = isErrorInstance(error, SnsFeedbackBoundaryError)
            ? error
            : null;
          if (boundaryError === null || boundaryError.retryable) {
            if (boundaryError === null) {
              logOperationalError(
                request.log,
                'account-email.feedback-subscription-confirmation.unclassified',
                error,
              );
            } else {
              request.log.error(
                {
                  requestId: request.id,
                  snsFeedbackFailure: boundaryError.diagnostic(),
                },
                'SNS feedback subscription confirmation failed',
              );
            }
            return reply.code(503).send({
              error: 'Feedback subscription confirmation is unavailable.',
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
            'Rejected email feedback subscription confirmation',
          );
          return reply
            .code(400)
            .send({ error: 'Invalid feedback notification.' });
        }
      }
      // Subscription ownership is confirmed only during an approved operation.
      return reply.code(202).send();
    }

    let parsed: ReturnType<typeof parseSesFeedbackDetailed>;
    try {
      parsed = parseSesFeedbackDetailed(envelope);
    } catch (error) {
      const payloadError = isErrorInstance(error, SesFeedbackPayloadError)
        ? error
        : null;
      if (payloadError === null) {
        logOperationalError(
          request.log,
          'account-email.feedback-payload.unclassified',
          error,
        );
        return reply.code(503).send({
          error: 'Feedback processing is unavailable.',
          requestId: request.id,
        });
      }
      request.log.warn(
        {
          emailFeedbackRejection: {
            category: 'authenticated-provider-payload',
            diagnostic: payloadError.diagnostic,
            requestId: request.id,
          },
        },
        'Rejected authenticated email feedback payload',
      );
      return reply.code(400).send({ error: 'Invalid feedback notification.' });
    }
    const event = parsed.event;
    if (event === null) {
      request.log.info(
        {
          ignoredAuthenticatedSesFeedback: parsed.diagnostic,
          requestId: request.id,
        },
        'Ignored unsupported authenticated SES feedback event',
      );
      return reply.code(204).send();
    }

    try {
      const result = await options.feedback.process(event);
      request.log.info(
        {
          emailFeedbackOutcome: result.outcome,
          emailFeedbackType: event.eventType,
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
}
