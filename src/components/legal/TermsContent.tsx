import { EmailLink, LegalDoc, P, Ul } from './legalShared'

const CONTACT_EMAIL = 'support@ascensionidle.com'

// Mirrors legal/terms-and-conditions.md at the repo root, which stays the
// canonical source when this needs a legal re-review -- keep the two in
// sync by hand if either changes (no build-time generation from the .md).
export default function TermsContent() {
  return (
    <LegalDoc
      title="Terms and Conditions"
      lastUpdated="1 September 2026"
      intro={
        <P>
          These Terms and Conditions ("Terms") form an agreement between you and Jordan Williams, an individual operating
          Ascension Idle (not a registered company) ("we", "us", "our"), governing your use of the Ascension Idle browser
          game (the "Game"). By creating an account or otherwise using the Game, you agree to these Terms. If you don't
          agree, please don't use the Game.
        </P>
      }
      sections={[
        {
          heading: '1. Eligibility',
          body: (
            <P>
              You must be at least 13 years old to create an account. If you are under 18, you confirm you have your parent
              or guardian's permission to use the Game and, once introduced, to make any purchase (see section 7).
            </P>
          ),
        },
        {
          heading: '2. Your account',
          body: (
            <Ul
              items={[
                "You're responsible for keeping your login details confidential and for all activity on your account.",
                <>
                  Each account is for personal, non-commercial use. You may not sell, trade, or transfer your account, or
                  any in-game item or currency, for real money or anything of real-world value outside of any official
                  payment feature we offer (see section 7). This includes so-called "real-money trading" (RMT) of accounts,
                  characters, gear, or currency.
                </>,
                'You must provide accurate information when registering and keep it up to date.',
                'We may suspend or terminate your account (see section 9) if you breach these Terms.',
              ]}
            />
          ),
        },
        {
          heading: '3. The Game',
          body: (
            <Ul
              items={[
                'Ascension Idle is an idle/incremental browser game. Gameplay, features, balance, drop rates, and content may change at any time as we develop the Game — nothing in these Terms guarantees any specific feature, rate, or balance will stay the same.',
                "The Game depends on our backend infrastructure being available. We don't guarantee the Game will be available uninterrupted, error-free, or at all times, and we're not liable for outages, maintenance windows, or data loss caused by factors outside our reasonable control.",
                "We may add, remove, or modify features (including virtual items, currencies, and events), and may reset, adjust, or discontinue the Game in whole or in part, at our discretion. Where reasonably practicable, we'll give notice of major changes that affect existing accounts.",
              ]}
            />
          ),
        },
        {
          heading: '4. Acceptable use',
          body: (
            <>
              <P>You agree not to:</P>
              <Ul
                items={[
                  'cheat, exploit bugs, use unauthorised third-party tools, or otherwise gain an unfair advantage;',
                  'attempt to gain unauthorised access to any account other than your own, or to our systems;',
                  'use the Game to harass, abuse, or harm other players, including via Global Chat, Mail, or the Marketplace;',
                  'engage in real-money trading of accounts, items, or currency (see section 2);',
                  'use the Game for any unlawful purpose.',
                ]}
              />
              <P>
                We may investigate suspected breaches and take action including warnings, temporary suspension, permanent
                account termination, and reversal of ill-gotten gains, at our discretion.
              </P>
            </>
          ),
        },
        {
          heading: '5. Virtual items and currency',
          body: (
            <Ul
              items={[
                <>
                  Gold, Comets, Fallen Stars, Ascension Points, gear, pets, and every other in-game item or currency
                  ("Virtual Items") are licensed to you for use within the Game only. They are not real currency, have no
                  real-world monetary value, and cannot be redeemed, exchanged, or cashed out for real money or anything of
                  real-world value, except through any official purchase feature we offer (see section 7 — which only ever
                  runs in one direction, real money to Virtual Items, not back).
                </>,
                'Virtual Items remain our property at all times. We may adjust, rebalance, or remove Virtual Items, or reset account progress, at our discretion, including for game-balance, security, or technical reasons.',
                'If your account is terminated for any reason, you lose access to all Virtual Items associated with it, whether or not you paid real money for any of them.',
              ]}
            />
          ),
        },
        {
          heading: '6. Advertising (planned feature)',
          body: (
            <>
              <P>
                We plan to introduce optional rewarded advertising — watching an ad, entirely at your choice, in exchange for
                an in-game bonus. When this launches:
              </P>
              <Ul
                items={[
                  'watching ads will always be optional, never required to progress through core gameplay;',
                  "ads will be served by a third-party advertising partner, and our Privacy Policy will be updated to describe what that partner collects;",
                  'these Terms will be updated with any additional rules specific to that feature before it goes live.',
                ]}
              />
            </>
          ),
        },
        {
          heading: '7. Purchases (planned feature)',
          body: (
            <>
              <P>We plan to introduce an optional paid VIP Token purchase in a future update. When this launches:</P>
              <Ul
                items={[
                  'prices will be shown in Australian dollars (or your local currency, if converted by the payment processor) before you confirm a purchase;',
                  "payments will be processed by a third-party payment processor — we will not directly store your full card details;",
                  'all purchases are for a licence to use Virtual Items within the Game, not a sale of the Virtual Items themselves, and (as above) are not redeemable for real money;',
                  <>
                    <strong className="text-slate-100">Your rights under the Australian Consumer Law are not affected.</strong>{' '}
                    Our goods and services come with guarantees that cannot be excluded under the Australian Consumer Law.
                    You are entitled to a replacement or refund for a major failure, and compensation for any other
                    reasonably foreseeable loss or damage. You are also entitled to have digital content repaired or
                    replaced if it fails to be of acceptable quality, and this failure does not amount to a major failure.
                  </>,
                  'Beyond those non-excludable guarantees, purchases of Virtual Items are generally final and non-refundable (e.g. change of mind), except as required by law or as we otherwise state at the time of purchase.',
                  'We will publish specific purchase/refund terms for the VIP Token feature before it launches, and this section will be updated accordingly.',
                ]}
              />
            </>
          ),
        },
        {
          heading: '8. Intellectual property',
          body: (
            <>
              <Ul
                items={[
                  'All game code, art, names, logos, and other content in the Game (other than content you submit — see section 8a) are owned by Jordan Williams or our licensors, and are protected by copyright and other intellectual property laws. Nothing in these Terms transfers any of that ownership to you.',
                  "You're granted a limited, personal, non-transferable, revocable licence to access and play the Game for your own non-commercial entertainment. You may not copy, modify, distribute, sell, or reverse-engineer any part of the Game except as permitted by law.",
                ]}
              />
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-300">8a. Content you submit</h4>
                <P>
                  If you submit content to the Game (Global Chat messages, Mail, marketplace listings, Suggestions, Bug
                  Reports, Plans, or similar), you keep ownership of it, but you grant us a non-exclusive, royalty-free,
                  worldwide licence to display, store, and use that content to operate and improve the Game (for example,
                  showing your chat message to other players, or using your bug report to fix an issue). Don't submit
                  anything unlawful, infringing, or that you don't have the right to share.
                </P>
              </div>
            </>
          ),
        },
        {
          heading: '9. Suspension and termination',
          body: (
            <P>
              We may suspend or terminate your access to the Game, in whole or in part, at any time, with or without notice,
              if we reasonably believe you've breached these Terms, engaged in cheating or abuse, or for security, legal, or
              operational reasons. You may stop using the Game, or request account deletion, at any time (see our Privacy
              Policy for how).
            </P>
          ),
        },
        {
          heading: '10. Liability',
          body: (
            <>
              <P>To the maximum extent permitted by law:</P>
              <Ul
                items={[
                  'the Game is provided "as is" and "as available," without warranties of any kind beyond those that cannot be excluded under the Australian Consumer Law;',
                  "we are not liable for any indirect, incidental, or consequential loss arising from your use of the Game, including loss of Virtual Items, account data, or progress;",
                  'our total liability to you for any claim arising from these Terms or the Game is limited, at our option, to resupplying the relevant service or the amount you paid us (if any) in the 12 months before the claim arose.',
                ]}
              />
              <P>
                Nothing in these Terms excludes, restricts, or modifies any right or remedy you have under the Australian
                Consumer Law that cannot lawfully be excluded, restricted, or modified.
              </P>
            </>
          ),
        },
        {
          heading: '11. Changes to these Terms',
          body: (
            <P>
              We may update these Terms from time to time, particularly as we introduce new features (like advertising and
              purchases). We'll update the "Last updated" date, and for material changes, we'll take reasonable steps to
              notify active players before the change takes effect. Continuing to use the Game after a change takes effect
              means you accept the updated Terms.
            </P>
          ),
        },
        {
          heading: '12. Governing law',
          body: (
            <P>
              These Terms are governed by the laws of Queensland, Australia, and you submit to the non-exclusive
              jurisdiction of the courts of that state/territory.
            </P>
          ),
        },
        {
          heading: '13. General',
          body: (
            <Ul
              items={[
                'If any part of these Terms is found unenforceable, the rest continues to apply.',
                'These Terms, together with our Privacy Policy, are the entire agreement between you and us about your use of the Game.',
                'We may assign or transfer these Terms (for example, if the Game changes ownership); you may not, without our consent.',
              ]}
            />
          ),
        },
        {
          heading: '14. Contact us',
          body: (
            <P>
              Questions about these Terms: <EmailLink address={CONTACT_EMAIL} />
            </P>
          ),
        },
      ]}
    />
  )
}
