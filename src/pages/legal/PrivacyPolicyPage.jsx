// src/pages/legal/PrivacyPolicyPage.jsx
// Public privacy policy. Linked from the Google OAuth consent screen, so it must
// spell out exactly what Google account data the app touches and how — the
// "Limited Use" disclosure below is what Google looks for when a sensitive scope
// (calendar.events) is requested.
import LegalShell, { Section } from './LegalShell';

const CONTACT_EMAIL = 'bapsjaipur2005@gmail.com';
const UPDATED = '11 September 2026';

export default function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={UPDATED}>
      <Section>
        <p>
          BAPS Jaipur MDS (“the app”, “we”, “us”) is an internal contact- and
          seva-management tool used by authorised karyakartas of BAPS Swaminarayan
          Sanstha, Jaipur. This policy explains what information the app handles and
          how it is used. It is not a public sign-up service — accounts are created
          only by administrators.
        </p>
      </Section>

      <Section heading="Information the app stores">
        <p>The app stores contact and coordination data entered by authorised karyakartas, which may include:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Names, phone numbers, addresses and household details of devotees and volunteers;</li>
          <li>Dates of birth and anniversaries, used for reminders;</li>
          <li>Mandal / area assignments and seva records used to coordinate activities.</li>
        </ul>
        <p>
          This data is held in Google Firebase (Firestore, Authentication and Cloud
          Storage) and is accessible only to signed-in karyakartas, each limited to
          the mandals and areas their role permits.
        </p>
      </Section>

      <Section heading="Google account data and the Calendar permission">
        <p>
          Connecting Google Calendar is <strong>optional</strong>. If a karyakarta
          chooses to connect it, the app requests the{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">
            https://www.googleapis.com/auth/calendar.events
          </code>{' '}
          permission and uses it for one purpose only: to create and update birthday
          and anniversary reminder events in <strong>that karyakarta’s own Google
          Calendar</strong>, for the contacts within their assigned mandal and area.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The app does <strong>not</strong> read, list or modify any of the user’s existing calendar events other than the reminder events it creates.</li>
          <li>The app does <strong>not</strong> access Gmail, Drive, Contacts or any other Google data.</li>
          <li>Reminder events are written with stable identifiers, so editing a contact’s date updates the existing event rather than creating a duplicate.</li>
          <li>The app reads the user’s email address (via the standard <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">openid&nbsp;email</code> scopes) only to show which account is connected.</li>
        </ul>
        <p>
          To keep the calendar in sync, the app stores a Google refresh token on the
          server (Firebase). It is held securely, is never exposed to any browser,
          and is never shared with anyone. You can disconnect at any time from within
          the app, or revoke access directly at{' '}
          <a className="text-orange-600 hover:underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            myaccount.google.com/permissions
          </a>
          ; doing so deletes the stored token.
        </p>
      </Section>

      <Section heading="Limited Use disclosure">
        <p>
          The app’s use and transfer of information received from Google APIs adheres
          to the{' '}
          <a className="text-orange-600 hover:underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements. Google user data is used solely to
          provide and improve the calendar-reminder feature described above and is not
          transferred to others, used for advertising, or used for any other purpose.
        </p>
      </Section>

      <Section heading="Sharing">
        <p>
          We do not sell or share personal data with third parties. Data is processed
          only through Google Firebase and Google APIs as described above, in order to
          run the app.
        </p>
      </Section>

      <Section heading="Retention and removal">
        <p>
          Contact data is retained for as long as it is needed to coordinate seva, and
          is removed on request by an administrator. Google Calendar tokens are removed
          as soon as a user disconnects or revokes access.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          For any question about this policy or to request removal of your data, write
          to{' '}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
