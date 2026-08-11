import { describe, expect, test } from 'vitest';
import { UserFacingError } from '../src/renderer/src/UserFacingError';

class UserFacingErrorTestSuite {
  public register(): void {
    describe('user-facing error messages', () => {
      test('explains an incorrect code without protocol terminology', () => {
        const message = UserFacingError.from(
          new Error('Error invoking remote method connectivity: The verification code does not match the requesting computer.')
        );

        expect(message).toBe('That code is incorrect. Check the six digits shown on the requesting PC and try again.');
        expect(message).not.toMatch(/token|protocol|verification/i);
      });

      test('turns socket and discovery failures into actionable guidance', () => {
        expect(UserFacingError.from(new Error('connect ECONNREFUSED 192.168.1.20:47778'))).toContain(
          'Make sure IStream is open'
        );
        expect(UserFacingError.from(new Error('That discovered peer is no longer available.'))).toBe(
          'That computer is offline. Open IStream there, then refresh the list.'
        );
      });

      test('hides secure-protocol details while recommending compatible versions', () => {
        const message = UserFacingError.from(new Error('Invalid secure control envelope.'));

        expect(message).toContain('Update IStream on both PCs');
        expect(message).not.toContain('envelope');
      });

      test('explains settings validation in plain language', () => {
        expect(UserFacingError.from(new Error('Unsupported target resolution.'))).toBe(
          'Choose one of the supported stream resolutions.'
        );
        expect(UserFacingError.from(new Error('Protected application list is invalid.'))).toContain(
          'Check the protected application names'
        );
      });

      test('does not expose unexpected internal exception text', () => {
        const message = UserFacingError.from(new Error('TypeError: cannot read internalSecret of undefined'));

        expect(message).toBe('Something went wrong. Try again. If it keeps happening, restart IStream on both computers.');
        expect(message).not.toContain('internalSecret');
      });
    });
  }
}

new UserFacingErrorTestSuite().register();
