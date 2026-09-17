import { qa, type HelpTopic } from '@/lib/help/types';

export const plans: HelpTopic = {
  id: 'plans',
  title: 'Plans, billing and licences',
  summary: 'What each plan includes, upgrading, cancelling and your licence key.',
  nodes: [
    qa('plan-compare', 'What is in Free, Pro and Lifetime?', [
      'Free: ClearVoice (on-device recognition, the tidied sentence, the Gemini answer and direct paste), Gesture Trainer with one gesture, the Sensory HUD and Studio.',
      'Pro ($14.99 a month or $129 a year): everything in Free plus the Fluency Coach, Therapy, unlimited gestures, the caregiver link with phone alerts, and session analytics.',
      'Lifetime ($299 once): everything in Pro, paid once, with every future release.',
    ], { keywords: ['how much', 'expensive', 'cheap', 'plans', 'pricing', 'price', 'cost', 'features', 'compare', 'free vs pro'], see: ['plan-upgrade', 'plan-lifetime'], link: { label: 'See pricing', href: '/#pricing' } }),
    qa('plan-free-limits', 'What are the limits on Free?', [
      'One gesture in Gesture Trainer, and no Fluency Coach, Therapy, caregiver sharing or session analytics. ClearVoice has no limits on Free.',
      'Anything Pro-only in the app shows a Pro badge and explains what it adds.',
    ], { keywords: ['free plan', 'limit', 'restrictions', 'what is free'], see: ['plan-compare'] }),
    qa('plan-upgrade', 'How do I upgrade?', [
      'Go to Pricing on this website, choose Pro Monthly, Pro Annual or Lifetime and check out while signed in. The plan applies to your account at once; the desktop app picks it up within a few minutes, or straight away if you sign out and back in.',
    ], { keywords: ['upgrade', 'buy', 'subscribe', 'purchase', 'go pro'], see: ['plan-demo-checkout', 'trouble-still-free'] }),
    qa('plan-demo-checkout', 'Will I be charged?', [
      'Not today. Checkout on this website is a demonstration: no payment processor is connected and no money is taken. Use the test card 4242 4242 4242 4242 with any future expiry and any three-digit CVC.',
      'Only the card brand and last four digits are stored.',
    ], { keywords: ['charge', 'payment', 'test card', '4242', 'credit card', 'money'], see: ['plan-upgrade'] }),
    qa('plan-annual', 'Is annual cheaper than monthly?', [
      'Yes. Pro Annual is $129 a year, about $10.75 a month, compared with $14.99 a month: roughly 28% less. The toggle above the plans switches the prices.',
    ], { keywords: ['annual', 'yearly', 'monthly', 'discount', 'save'], see: ['plan-compare'] }),
    qa('plan-lifetime', 'What does Lifetime mean?', [
      'Pro, paid once, with no renewal. It includes every future release of the app. There is nothing to cancel.',
    ], { keywords: ['lifetime', 'one time', 'forever', 'perpetual'], see: ['plan-compare'] }),
    qa('plan-cancel', 'How do I cancel?', [
      'Open your profile on this website and press "Cancel renewal" under Plan and licence. Pro stays available until the end of the period you paid for, then the account returns to Free.',
      'Lifetime has nothing to cancel.',
    ], { keywords: ['cancel', 'stop subscription', 'unsubscribe', 'end plan'], see: ['plan-after-expiry'] }),
    qa('plan-after-expiry', 'What happens when a plan ends?', [
      'The account returns to Free at the end of the period. Nothing is deleted: saved sessions stay yours, presets and targets stay in the account, and gestures beyond the Free limit are paused (not removed) until you upgrade again.',
      'Caregivers you approved can no longer connect until you are on Pro again, because sharing is a Pro feature.',
    ], { keywords: ['expired', 'lapsed', 'downgrade', 'ends', 'renewal failed'], see: ['plan-cancel'] }),
    qa('plan-license', 'What is the licence key for?', [
      'It ties the desktop app to your account and plan. The app checks it when you sign in and binds it to the computer (as a one-way fingerprint). You can see and copy it on your profile.',
    ], { keywords: ['licence', 'license', 'key', 'serial', 'activation'], see: ['plan-license-move', 'trouble-license'] }),
    qa('plan-license-move', 'How do I move my licence to another computer?', [
      'In the desktop app on the computer that has it, open Account and deactivate the licence there. Then sign in on the new computer; the licence binds to it.',
      'If the old computer is gone, contact the Voicematics team with the account’s email address.',
    ], { keywords: ['move licence', 'transfer license', 'new computer', 'hardware mismatch', 'deactivate'], see: ['trouble-license'] }),
    qa('plan-new-key', 'Why did my licence key change?', [
      'Each checkout issues a fresh key for the new plan, and the older key stops validating. Copy the current one from your profile if the app ever asks for it.',
    ], { keywords: ['new key', 'key changed', 'old key'], see: ['plan-license'] }),
    qa('plan-refund', 'Can I get a refund?', [
      'Checkout is a demonstration and takes no money, so there is nothing to refund today.',
    ], { keywords: ['refund', 'money back', 'return'], see: ['plan-demo-checkout'] }),
    qa('plan-discounts', 'Are there discounts for students, clinics or schools?', [
      'Not as a separate plan today. Free covers ClearVoice without limits, and Pro Annual is the lowest price for the full set. Caregivers never need a paid plan.',
    ], { keywords: ['student', 'education', 'clinic', 'school', 'discount', 'nonprofit', 'bulk'], see: ['plan-compare', 'cg-no-pro'] }),
    qa('plan-invoice', 'Can I get an invoice?', [
      'Not while checkout is a demonstration. The profile page shows the plan, the amount and the renewal date.',
    ], { keywords: ['invoice', 'receipt', 'billing history'] }),
  ],
};
