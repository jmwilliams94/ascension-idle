import { EmailLink, ExternalLink, LegalDoc, Note, P, Ul } from './legalShared'

const CONTACT_EMAIL = 'support@ascensionidle.com'

// Mirrors legal/privacy-policy.md at the repo root, which stays the
// canonical source when this needs a legal re-review -- keep the two in
// sync by hand if either changes (no build-time generation from the .md).
export default function PrivacyPolicyContent() {
  return (
    <LegalDoc
      title="Privacy Policy"
      lastUpdated="1 September 2026"
      intro={
        <>
          <P>
            This Privacy Policy explains how Jordan Williams ("we", "us", "our") collects, holds, uses and discloses personal
            information in connection with the Ascension Idle browser game (the "Game"). It is written to comply with the
            Australian Privacy Principles (APPs) in the Privacy Act 1988 (Cth).
          </P>
          <Note>
            Jordan Williams currently operates below the AU$3 million annual turnover threshold at which the Privacy Act's
            small business exemption would normally apply. This Policy is provided voluntarily, to the standard the APPs
            require, regardless of whether the exemption strictly applies.
          </Note>
        </>
      }
      sections={[
        {
          heading: '1. Who we are',
          body: (
            <>
              <P>
                Ascension Idle is developed and operated by Jordan Williams, an individual operating Ascension Idle (not a
                registered company), based in Queensland, Australia.
              </P>
              <P>
                Contact for any privacy question, complaint, or request: <EmailLink address={CONTACT_EMAIL} />
              </P>
            </>
          ),
        },
        {
          heading: '2. What personal information we collect',
          body: (
            <>
              <P>We only collect what the Game actually needs to run your account and let you play. Specifically:</P>
              <Ul
                items={[
                  <>
                    <strong className="text-slate-100">Account/authentication data</strong>: your email address and a securely
                    hashed password, collected when you register, via our authentication provider (Supabase Auth).
                  </>,
                  <>
                    <strong className="text-slate-100">Gameplay data</strong>: your characters, inventory, currency balances,
                    achievements, and other in-game progress, tied to your account.
                  </>,
                  <>
                    <strong className="text-slate-100">User-generated content</strong>: anything you type into Global Chat,
                    Mail, the Marketplace, or the in-game Suggestions/Bug Report/Plan forms. Please don't include personal
                    information about yourself or anyone else in this content beyond what's needed — it may be visible to
                    other players (chat, mail, marketplace listings) or to us (support forms).
                  </>,
                  <>
                    <strong className="text-slate-100">Push notification data</strong> (only if you opt in): your browser's
                    push subscription endpoint and encryption keys, plus basic browser/device information, so we can deliver
                    notifications like "your Lucky Lad ticket is ready." You can withdraw this at any time from Settings.
                  </>,
                  <>
                    <strong className="text-slate-100">Technical/log data</strong>: standard web server and infrastructure
                    logs (e.g. IP address, browser type, request timestamps) collected automatically by our hosting and
                    infrastructure providers (see section 5) for security and reliability purposes.
                  </>,
                ]}
              />
              <P>
                We do not currently collect payment/financial information, and we do not currently run advertising. Section 8
                below explains what will change if we introduce those features.
              </P>
            </>
          ),
        },
        {
          heading: '3. How we collect personal information',
          body: (
            <P>
              We collect personal information directly from you when you register an account, play the Game, use in-game
              social/support features, or opt into push notifications. Technical/log data is collected automatically by the
              infrastructure that runs the Game.
            </P>
          ),
        },
        {
          heading: '4. Why we collect, hold, use and disclose personal information',
          body: (
            <>
              <P>We use personal information to:</P>
              <Ul
                items={[
                  'create and secure your account, and let you log in;',
                  'operate the Game — save your progress, run gameplay, and enable social features like chat, mail, and the marketplace;',
                  "send you push notifications you've opted into;",
                  'respond to support requests, bug reports, and suggestions;',
                  'maintain the security, integrity, and fair play of the Game (e.g. investigating cheating or abuse);',
                  'comply with our legal obligations.',
                ]}
              />
              <P>We don't sell your personal information, and we don't use it for unrelated marketing.</P>
            </>
          ),
        },
        {
          heading: '5. Who we disclose personal information to',
          body: (
            <>
              <P>
                We share personal information with the service providers that run the Game's infrastructure, strictly so they
                can provide that infrastructure to us:
              </P>
              <Ul
                items={[
                  <>
                    <strong className="text-slate-100">Supabase</strong> (database, authentication, and backend hosting) —
                    stores your account and gameplay data.
                  </>,
                  <>
                    <strong className="text-slate-100">GitHub Pages</strong> — serves the Game's web app files.
                  </>,
                  'A push notification delivery service, only for the push subscription data described above, if you opt in.',
                ]}
              />
              <P>
                We may also disclose personal information if required by law, or to protect the rights, property, or safety
                of Jordan Williams, our players, or the public (for example, in response to a valid legal request).
              </P>
            </>
          ),
        },
        {
          heading: '6. Overseas disclosure',
          body: (
            <P>
              Some of the service providers listed in section 5 may store or process data outside Australia. In particular,
              our database is hosted with Supabase in the Southeast Asia (Singapore) region. Where personal information is
              disclosed overseas, we take reasonable steps to ensure it's handled consistently with the Australian Privacy
              Principles, including relying on our providers' own contractual and security commitments.
            </P>
          ),
        },
        {
          heading: '7. Cookies and similar technologies',
          body: (
            <P>
              The Game currently uses browser local storage and a service worker (for offline app functionality and update
              handling) — not tracking cookies or third-party analytics. If we introduce advertising (see section 8), some
              cookies or device identifiers may be introduced by our advertising partners at that time, and this Policy will
              be updated accordingly before that happens.
            </P>
          ),
        },
        {
          heading: '8. Planned features: advertising and payments',
          body: (
            <>
              <P>We're planning to introduce, in future updates:</P>
              <Ul
                items={[
                  <>
                    <strong className="text-slate-100">Optional rewarded advertising</strong> (e.g. watch an ad for an
                    in-game bonus), served through a third-party advertising network. When this launches, this Policy will
                    be updated to name the specific provider(s) and describe what they collect (typically device/advertising
                    identifiers, IP address, and ad interaction data) and how you can manage ad personalisation where the
                    provider supports it.
                  </>,
                  <>
                    <strong className="text-slate-100">An optional paid VIP Token purchase</strong>, processed through a
                    third-party payment processor (e.g. Stripe). When this launches, this Policy will be updated to describe
                    what payment-related data is collected — we do not intend to store your full card details ourselves;
                    that will be handled directly by the payment processor.
                  </>,
                ]}
              />
              <P>
                We will update the "Last updated" date above and, for material changes, take reasonable steps to notify
                active players (e.g. an in-game notice) before these features go live.
              </P>
            </>
          ),
        },
        {
          heading: '9. Data security',
          body: (
            <P>
              We take reasonable technical and organisational steps to protect the personal information we hold, including
              relying on Supabase's authentication and row-level security controls to restrict data access to your own
              account. No online service can guarantee perfect security, but we work to keep your information safe and will
              respond promptly to any suspected data breach in line with our obligations under the Notifiable Data Breaches
              scheme.
            </P>
          ),
        },
        {
          heading: '10. Data retention and deletion',
          body: (
            <>
              <P>We retain your account and gameplay data for as long as your account is active, so you can keep playing without losing progress.</P>
              <Ul
                items={[
                  <>
                    <strong className="text-slate-100">Deleting a character</strong> removes that character and its data
                    immediately and permanently, but does not delete your account as a whole.
                  </>,
                  <>
                    <strong className="text-slate-100">Deleting your whole account</strong>: we don't yet have a
                    self-service "delete my account" button in the Game. Until we do, you can request full account deletion
                    by emailing <EmailLink address={CONTACT_EMAIL} /> — we'll verify you're the account holder and delete
                    your personal information within a reasonable time, except where we're required or permitted by law to
                    keep it (e.g. fraud prevention records).
                  </>,
                ]}
              />
            </>
          ),
        },
        {
          heading: "11. Children's privacy",
          body: (
            <P>
              Ascension Idle is intended for players aged 13 and over. If you are under 18, you should have a parent or
              guardian's permission to create an account, and definitely before making any purchase once paid features are
              introduced. We don't knowingly collect personal information from children under 13; if you believe a child
              under 13 has created an account, please contact us at <EmailLink address={CONTACT_EMAIL} /> and we'll take
              reasonable steps to delete it.
            </P>
          ),
        },
        {
          heading: '12. Access, correction, and complaints',
          body: (
            <>
              <P>You have the right under the Australian Privacy Principles to:</P>
              <Ul
                items={[
                  'ask for access to the personal information we hold about you;',
                  "ask us to correct it if it's inaccurate, out of date, or incomplete.",
                ]}
              />
              <P>
                To do either, email <EmailLink address={CONTACT_EMAIL} />. We'll respond within a reasonable time and won't
                charge you for the request.
              </P>
              <P>
                If you're unhappy with how we've handled your personal information, please contact us first at{' '}
                <EmailLink address={CONTACT_EMAIL} /> so we can try to resolve it. If you're not satisfied with our response,
                you can lodge a complaint with the Office of the Australian Information Commissioner (OAIC) at{' '}
                <ExternalLink href="https://www.oaic.gov.au">oaic.gov.au</ExternalLink>.
              </P>
            </>
          ),
        },
        {
          heading: '13. Changes to this Policy',
          body: (
            <P>
              We may update this Policy from time to time, particularly as new features (like advertising and payments) are
              introduced. We'll update the "Last updated" date, and for material changes, we'll take reasonable steps to let
              active players know before the change takes effect.
            </P>
          ),
        },
        {
          heading: '14. Contact us',
          body: (
            <P>
              Questions, requests, or complaints about this Policy or your personal information: <EmailLink address={CONTACT_EMAIL} />
            </P>
          ),
        },
      ]}
    />
  )
}
