import { env } from '../env';
import { sendEmail } from '../clients/resend.client';

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${env.APP_URL}/reset-password/confirm?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: 'CRM Demo — Resetowanie hasła',
    html: `
      <p>Otrzymaliśmy prośbę o reset hasła do Twojego konta CRM Demo.</p>
      <p><a href="${url}">Kliknij tutaj, aby ustawić nowe hasło</a> (link ważny 1 godzinę).</p>
      <p>Jeśli to nie Ty — zignoruj tę wiadomość.</p>
    `,
    text: `Resetowanie hasła CRM Demo\n\nOtwórz link (ważny 1h): ${url}\n\nJeśli to nie Ty — zignoruj.`,
  });
}

export async function sendInvitationEmail(to: string, inviteUrl: string, inviterName: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'CRM Demo — Zaproszenie do systemu',
    html: `
      <p>Cześć,</p>
      <p>${inviterName} zaprosił(a) Cię do systemu CRM Demo.</p>
      <p><a href="${inviteUrl}">Kliknij tutaj, aby utworzyć swoje konto</a></p>
      <p>Link jest ważny 7 dni.</p>
      <p>Jeśli nie spodziewałeś(aś) się tego zaproszenia — zignoruj wiadomość.</p>
    `,
    text: `CRM Demo Invitation\n\n${inviterName} invited you to CRM Demo.\n\nCreate your account: ${inviteUrl}\n\nLink valid for 7 days.\n\nIf you didn't expect this — ignore.`,
  });
}

// Built-in consent request / preference letter. Sent when there is no
// designated template — carries the unique confirm/manage link. Transactional
// (managing the recruitment relationship the candidate initiated), not an offer.
export async function sendConsentRequestEmail(
  to: string,
  manageUrl: string,
  name: string | null,
): Promise<void> {
  const greeting = name && name.trim() ? name.trim() : '';
  await sendEmail({
    to,
    subject: 'CRM Demo — Zgoda na kontakt / Згода на контакт',
    html: `
      <p>Dzień dobry${greeting ? ` ${greeting}` : ''},</p>
      <p>Prosimy o potwierdzenie, jak możemy się z Tobą kontaktować w sprawie ofert pracy.
      Wybierz kanały (e-mail / SMS) i zapisz swoje preferencje:</p>
      <p><a href="${manageUrl}">Ustaw swoje preferencje</a></p>
      <hr />
      <p>Доброго дня${greeting ? `, ${greeting}` : ''}!</p>
      <p>Просимо підтвердити, як з вами зв'язуватися щодо пропозицій роботи. Оберіть
      канали (email / SMS) і збережіть налаштування:</p>
      <p><a href="${manageUrl}">Налаштувати</a></p>
      <p style="color:#888;font-size:12px">Zmienić lub wycofać zgodę możesz w każdej chwili tym linkiem,
      lub pisząc do nas. / Змінити чи відкликати згоду можна будь-коли за цим лінком або написавши нам.</p>
    `,
    text: `CRM Demo — Ustaw swoje preferencje kontaktu / Налаштуйте контакт: ${manageUrl}`,
  });
}

export async function sendAccountLockedEmail(to: string, unlockAt: Date): Promise<void> {
  await sendEmail({
    to,
    subject: 'CRM Demo — Konto tymczasowo zablokowane',
    html: `
      <p>Twoje konto zostało zablokowane po zbyt wielu nieudanych próbach logowania.</p>
      <p>Odblokowanie nastąpi automatycznie o: <strong>${unlockAt.toISOString()}</strong>.</p>
      <p>Jeśli to nie były Twoje próby — odezwij się do administratora.</p>
    `,
  });
}
