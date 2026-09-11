// src/pages/legal/TermsPage.jsx
// Public terms of service. Linked from the Google OAuth consent screen (required
// for external production apps). Kept short and honest — this is an internal tool
// for authorised karyakartas, not a public service.
import LegalShell, { Section } from './LegalShell';

const CONTACT_EMAIL = 'bapsjaipur2005@gmail.com';
const UPDATED = '11 September 2026';

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated={UPDATED}>
      <Section>
        <p>
          BAPS Jaipur MDS is a private, internal application for authorised
          karyakartas of BAPS Swaminarayan Sanstha, Jaipur. By signing in and using
          the app you agree to these terms.
        </p>
      </Section>

      <Section heading="Who may use the app">
        <p>
          Access is limited to karyakartas whose accounts have been created by an
          administrator. There is no public sign-up. You are responsible for keeping
          your login credentials confidential and for all activity under your account.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <ul className="list-disc space-y-1 pl-5">
          <li>Use the app only for coordinating the Sanstha’s seva and activities.</li>
          <li>Treat all contact information as confidential; do not export, copy or share it outside authorised seva.</li>
          <li>Do not attempt to access data outside the mandals and areas your role permits.</li>
        </ul>
      </Section>

      <Section heading="Google Calendar sync">
        <p>
          Connecting Google Calendar is optional and provided for your convenience to
          place birthday and anniversary reminders for your assigned contacts into
          your own calendar. It is offered “as is”; you can disconnect at any time.
          Its handling of Google data is described in our{' '}
          <a className="text-orange-600 hover:underline" href="/privacy">Privacy Policy</a>.
        </p>
      </Section>

      <Section heading="Availability and changes">
        <p>
          The app is maintained on a best-effort basis for the Sanstha’s use and may
          change or be unavailable from time to time. We may update these terms; the
          date above reflects the latest revision.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about these terms can be sent to{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
