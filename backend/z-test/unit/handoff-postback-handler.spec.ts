import {
  type ChainResumeResult,
  type HandoffPostbackDeps,
  handleHandoffChainPostback,
} from '@/modules/webhook';

/**
 * [FIX-20260808-CHAINPOSTBACK] handoff-chain postback handler.
 * Ports legacy legacy-api/src/services/handoff/chain/postback.js `handlePostback`.
 *
 * Pure unit test: no Mongo, no LINE, no network. Every runtime collaborator
 * (`resume`, `sendChainReply`) is a fake spy passed through `deps`, so a passing
 * run cannot have touched the un-ported chain engine or opened a socket.
 */

const postbackEvent = (data?: string, replyToken = 'rt-1') => ({
  type: 'postback',
  replyToken,
  postback: { data },
});

describe('handleHandoffChainPostback', () => {
  describe('guards (legacy chains-off / not-ours branches)', () => {
    it('chains disabled → not handled, falls through', async () => {
      const r = await handleHandoffChainPostback(
        postbackEvent('hoc:resume:run1:1'),
        { chainsEnabled: false },
      );
      expect(r).toEqual({ handled: false });
    });

    it('non-postback event → not handled', async () => {
      const r = await handleHandoffChainPostback(
        { type: 'message', postback: { data: 'hoc:resume:run1:1' } },
        { chainsEnabled: true },
      );
      expect(r).toEqual({ handled: false });
    });

    it('null / undefined event → not handled', async () => {
      expect(
        await handleHandoffChainPostback(null, { chainsEnabled: true }),
      ).toEqual({ handled: false });
      expect(
        await handleHandoffChainPostback(undefined, { chainsEnabled: true }),
      ).toEqual({ handled: false });
    });

    it('postback data not a "hoc:" string → not handled (legacy:22-23)', async () => {
      for (const data of [undefined, '', 'foo:bar', 'HOC:resume:x:1']) {
        const r = await handleHandoffChainPostback(postbackEvent(data), {
          chainsEnabled: true,
        });
        expect(r).toEqual({ handled: false });
      }
    });
  });

  describe('ownership swallow (legacy:26)', () => {
    it('"hoc:" but sub-action is not "resume" → handled, no-op', async () => {
      const resume = jest.fn();
      const r = await handleHandoffChainPostback(
        postbackEvent('hoc:cancel:run1'),
        { chainsEnabled: true, resume },
      );
      expect(r).toEqual({ handled: true });
      expect(resume).not.toHaveBeenCalled();
    });
  });

  describe('runtime un-ported (blocking-dep branch)', () => {
    it('"hoc:resume:*" with NO resume dep → consumed (handled), no crash', async () => {
      const r = await handleHandoffChainPostback(
        postbackEvent('hoc:resume:run1:2'),
        { chainsEnabled: true },
      );
      expect(r).toEqual({ handled: true });
    });
  });

  describe('runtime present (legacy:28-42 full path)', () => {
    const okResult: ChainResumeResult = { ok: true, run: { _id: 'run1' } };

    it('parses runId + nextIdx + replyToken and calls resume', async () => {
      const resume = jest.fn().mockResolvedValue(okResult);
      const deps: HandoffPostbackDeps = { chainsEnabled: true, resume };
      const r = await handleHandoffChainPostback(
        postbackEvent('hoc:resume:runABC:5', 'tok-9'),
        deps,
      );
      expect(r).toEqual({ handled: true });
      expect(resume).toHaveBeenCalledWith('runABC', 5, 'tok-9');
    });

    it('nextIdx defaults to 0 when unparseable (legacy `|| 0`)', async () => {
      const resume = jest.fn().mockResolvedValue(okResult);
      await handleHandoffChainPostback(postbackEvent('hoc:resume:runX'), {
        chainsEnabled: true,
        resume,
      });
      expect(resume).toHaveBeenCalledWith('runX', 0, 'rt-1');
    });

    it('ok result → does NOT send a reply (runner replies on its own)', async () => {
      const resume = jest.fn().mockResolvedValue(okResult);
      const sendChainReply = jest.fn();
      await handleHandoffChainPostback(postbackEvent('hoc:resume:run1:1'), {
        chainsEnabled: true,
        resume,
        sendChainReply,
      });
      expect(sendChainReply).not.toHaveBeenCalled();
    });

    it('slip_locked → sends the success terminal (legacy:37)', async () => {
      const run = { _id: 'run1' };
      const resume = jest
        .fn()
        .mockResolvedValue({ ok: false, reason: 'slip_locked', run });
      const sendChainReply = jest.fn().mockResolvedValue(undefined);
      await handleHandoffChainPostback(
        postbackEvent('hoc:resume:run1:1', 't'),
        {
          chainsEnabled: true,
          resume,
          sendChainReply,
        },
      );
      expect(sendChainReply).toHaveBeenCalledWith(run, {
        kind: 'success',
        replyToken: 't',
      });
    });

    it('exhausted → sends the contact_agent terminal (legacy:39)', async () => {
      const run = { _id: 'run1' };
      const resume = jest
        .fn()
        .mockResolvedValue({ ok: false, reason: 'exhausted', run });
      const sendChainReply = jest.fn().mockResolvedValue(undefined);
      await handleHandoffChainPostback(
        postbackEvent('hoc:resume:run1:1', 't'),
        {
          chainsEnabled: true,
          resume,
          sendChainReply,
        },
      );
      expect(sendChainReply).toHaveBeenCalledWith(run, {
        kind: 'contact_agent',
        replyToken: 't',
      });
    });

    it('other non-ok reason → no reply, still handled', async () => {
      const resume = jest
        .fn()
        .mockResolvedValue({ ok: false, reason: 'run_not_found' });
      const sendChainReply = jest.fn();
      const r = await handleHandoffChainPostback(
        postbackEvent('hoc:resume:run1:1'),
        { chainsEnabled: true, resume, sendChainReply },
      );
      expect(r).toEqual({ handled: true });
      expect(sendChainReply).not.toHaveBeenCalled();
    });
  });
});
