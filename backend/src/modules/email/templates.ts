/**
 * Account emails in the recipient's language (users.locale, migration 0070): the password reset
 * code, the email verification code and the new-device sign-in alert. Plain text, like the rest of
 * Katkee's mail; codes, links and device names stay as they are. Admin alerts stay English.
 */
import type { Locale } from "../../shared/locale";

interface Email {
  subject: string;
  text: string;
}

interface Templates {
  passwordReset: (code: string, link: string) => Email;
  emailVerification: (code: string) => Email;
  newDeviceLogin: (device: string | null) => Email;
  dataExportReady: (days: number) => Email;
}

const en: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} is your Katkee password reset code`,
    text:
      `Your Katkee password reset code is ${code}. It expires in 15 minutes.\n\n` +
      `Open this link on your phone to continue: ${link}\n\n` +
      "If you didn't ask to reset your password, you can ignore this email — your password won't change.",
  }),
  emailVerification: (code) => ({
    subject: `${code} is your Katkee verification code`,
    text:
      `Your Katkee verification code is ${code}. It expires in 30 minutes.\n\n` +
      "Enter it in the Katkee app to confirm this is your email address.\n\n" +
      "If you didn't create a Katkee account, you can ignore this email.",
  }),
  newDeviceLogin: (device) => ({
    subject: "New sign-in to your Katkee account",
    text:
      `Your Katkee account was just signed in on a new device${device ? ` (${device})` : ""}.\n\n` +
      "If this was you, there's nothing to do.\n" +
      "If it wasn't, open Katkee → Profile → Settings → Account security, choose \"Sign out of all devices\", and reset your password.",
  }),
  dataExportReady: (days) => ({
    subject: "Your Katkee data is ready to download",
    text:
      "The copy of your Katkee data you asked for is ready.\n\n" +
      "Open Katkee → Profile → Settings → Download your data to save it. " +
      `It's kept for ${days} days, then deleted.\n\n` +
      "If you didn't ask for this, change your password and choose \"Sign out of all devices\" in Account security.",
  }),
};

const hi: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} आपका Katkee पासवर्ड रीसेट कोड है`,
    text:
      `आपका Katkee पासवर्ड रीसेट कोड ${code} है। यह 15 मिनट में एक्सपायर हो जाएगा।\n\n` +
      `आगे बढ़ने के लिए यह लिंक अपने फ़ोन पर खोलें: ${link}\n\n` +
      "अगर आपने पासवर्ड रीसेट करने को नहीं कहा था, तो इस ईमेल को अनदेखा करें — आपका पासवर्ड नहीं बदलेगा।",
  }),
  emailVerification: (code) => ({
    subject: `${code} आपका Katkee वेरिफ़िकेशन कोड है`,
    text:
      `आपका Katkee वेरिफ़िकेशन कोड ${code} है। यह 30 मिनट में एक्सपायर हो जाएगा।\n\n` +
      "यह आपका ईमेल पता है, इसकी पुष्टि के लिए इसे Katkee ऐप में डालें।\n\n" +
      "अगर आपने Katkee अकाउंट नहीं बनाया, तो इस ईमेल को अनदेखा करें।",
  }),
  newDeviceLogin: (device) => ({
    subject: "आपके Katkee अकाउंट में नए डिवाइस से साइन इन",
    text:
      `आपके Katkee अकाउंट में अभी एक नए डिवाइस${device ? ` (${device})` : ""} से साइन इन हुआ है।\n\n` +
      "अगर यह आप थे, तो कुछ करने की ज़रूरत नहीं।\n" +
      "अगर नहीं, तो Katkee → प्रोफ़ाइल → सेटिंग्स → अकाउंट सुरक्षा खोलें, \"बाकी सभी डिवाइस से साइन आउट करें\" चुनें, और अपना पासवर्ड रीसेट करें।",
  }),
  dataExportReady: (days) => ({
    subject: "आपका Katkee डेटा डाउनलोड के लिए तैयार है",
    text:
      "आपने अपने Katkee डेटा की जो कॉपी माँगी थी, वह तैयार है।\n\n" +
      "सेव करने के लिए Katkee → प्रोफ़ाइल → सेटिंग्स → अपना डेटा डाउनलोड करें खोलें। " +
      `यह ${days} दिन तक रहेगा, फिर हटा दिया जाएगा।\n\n` +
      "अगर आपने यह नहीं माँगा था, तो अपना पासवर्ड बदलें और अकाउंट सुरक्षा में \"बाकी सभी डिवाइस से साइन आउट करें\" चुनें।",
  }),
};

const mr: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} हा तुमचा Katkee पासवर्ड रीसेट कोड आहे`,
    text:
      `तुमचा Katkee पासवर्ड रीसेट कोड ${code} आहे. तो 15 मिनिटांत एक्सपायर होईल.\n\n` +
      `पुढे जाण्यासाठी ही लिंक तुमच्या फोनवर उघडा: ${link}\n\n` +
      "तुम्ही पासवर्ड रीसेट करायला सांगितले नसेल, तर या ईमेलकडे दुर्लक्ष करा — तुमचा पासवर्ड बदलणार नाही.",
  }),
  emailVerification: (code) => ({
    subject: `${code} हा तुमचा Katkee व्हेरिफिकेशन कोड आहे`,
    text:
      `तुमचा Katkee व्हेरिफिकेशन कोड ${code} आहे. तो 30 मिनिटांत एक्सपायर होईल.\n\n` +
      "हा तुमचा ईमेल पत्ता आहे याची खात्री करण्यासाठी तो Katkee ॲपमध्ये टाका.\n\n" +
      "तुम्ही Katkee अकाउंट तयार केले नसेल, तर या ईमेलकडे दुर्लक्ष करा.",
  }),
  newDeviceLogin: (device) => ({
    subject: "तुमच्या Katkee अकाउंटमध्ये नवीन डिव्हाइसवरून साइन इन",
    text:
      `तुमच्या Katkee अकाउंटमध्ये आत्ताच एका नवीन डिव्हाइसवरून${device ? ` (${device})` : ""} साइन इन झाले.\n\n` +
      "हे तुम्हीच असाल, तर काहीही करण्याची गरज नाही.\n" +
      "तुम्ही नसाल, तर Katkee → प्रोफाइल → सेटिंग्ज → अकाउंट सुरक्षा उघडा, \"इतर सर्व डिव्हाइसवरून साइन आउट करा\" निवडा, आणि तुमचा पासवर्ड रीसेट करा.",
  }),
  dataExportReady: (days) => ({
    subject: "तुमचा Katkee डेटा डाउनलोडसाठी तयार आहे",
    text:
      "तुम्ही मागितलेली तुमच्या Katkee डेटाची प्रत तयार आहे.\n\n" +
      "सेव्ह करण्यासाठी Katkee → प्रोफाइल → सेटिंग्ज → तुमचा डेटा डाउनलोड करा उघडा. " +
      `ती ${days} दिवस ठेवली जाईल, नंतर हटवली जाईल.\n\n` +
      "तुम्ही हे मागितले नसेल, तर तुमचा पासवर्ड बदला आणि अकाउंट सुरक्षामध्ये \"इतर सर्व डिव्हाइसवरून साइन आउट करा\" निवडा.",
  }),
};

const es: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} es tu código para restablecer la contraseña de Katkee`,
    text:
      `Tu código para restablecer la contraseña de Katkee es ${code}. Vence en 15 minutos.\n\n` +
      `Abre este enlace en tu teléfono para continuar: ${link}\n\n` +
      "Si no pediste restablecer tu contraseña, puedes ignorar este correo: tu contraseña no cambiará.",
  }),
  emailVerification: (code) => ({
    subject: `${code} es tu código de verificación de Katkee`,
    text:
      `Tu código de verificación de Katkee es ${code}. Vence en 30 minutos.\n\n` +
      "Escríbelo en la app de Katkee para confirmar que este es tu correo.\n\n" +
      "Si no creaste una cuenta en Katkee, puedes ignorar este correo.",
  }),
  newDeviceLogin: (device) => ({
    subject: "Nuevo inicio de sesión en tu cuenta de Katkee",
    text:
      `Alguien acaba de iniciar sesión en tu cuenta de Katkee desde un dispositivo nuevo${device ? ` (${device})` : ""}.\n\n` +
      "Si fuiste tú, no tienes que hacer nada.\n" +
      "Si no fuiste tú, abre Katkee → Perfil → Configuración → Seguridad de la cuenta, elige \"Cerrar sesión en todos los dispositivos\" y restablece tu contraseña.",
  }),
  dataExportReady: (days) => ({
    subject: "Tus datos de Katkee están listos para descargar",
    text:
      "La copia de tus datos de Katkee que pediste está lista.\n\n" +
      "Abre Katkee → Perfil → Configuración → Descargar tus datos para guardarla. " +
      `Se guarda durante ${days} días y luego se elimina.\n\n` +
      "Si no la pediste, cambia tu contraseña y elige \"Cerrar sesión en todos los dispositivos\" en Seguridad de la cuenta.",
  }),
};

const pt: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} é seu código para redefinir a senha do Katkee`,
    text:
      `Seu código para redefinir a senha do Katkee é ${code}. Ele expira em 15 minutos.\n\n` +
      `Abra este link no celular para continuar: ${link}\n\n` +
      "Se você não pediu para redefinir a senha, ignore este e-mail: sua senha não vai mudar.",
  }),
  emailVerification: (code) => ({
    subject: `${code} é seu código de verificação do Katkee`,
    text:
      `Seu código de verificação do Katkee é ${code}. Ele expira em 30 minutos.\n\n` +
      "Digite-o no app do Katkee para confirmar que este é o seu e-mail.\n\n" +
      "Se você não criou uma conta no Katkee, ignore este e-mail.",
  }),
  newDeviceLogin: (device) => ({
    subject: "Novo login na sua conta do Katkee",
    text:
      `Sua conta do Katkee acabou de ser acessada em um novo dispositivo${device ? ` (${device})` : ""}.\n\n` +
      "Se foi você, não precisa fazer nada.\n" +
      "Se não foi, abra o Katkee → Perfil → Configurações → Segurança da conta, escolha \"Sair de todos os dispositivos\" e redefina sua senha.",
  }),
  dataExportReady: (days) => ({
    subject: "Seus dados do Katkee estão prontos para baixar",
    text:
      "A cópia dos seus dados do Katkee que você pediu está pronta.\n\n" +
      "Abra o Katkee → Perfil → Configurações → Baixar seus dados para salvá-la. " +
      `Ela fica disponível por ${days} dias e depois é apagada.\n\n` +
      "Se você não pediu isso, mude sua senha e escolha \"Sair de todos os dispositivos\" em Segurança da conta.",
  }),
};

const id: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} adalah kode reset kata sandi Katkee kamu`,
    text:
      `Kode reset kata sandi Katkee kamu adalah ${code}. Kode ini berlaku 15 menit.\n\n` +
      `Buka tautan ini di ponselmu untuk melanjutkan: ${link}\n\n` +
      "Kalau kamu tidak meminta reset kata sandi, abaikan email ini: kata sandimu tidak akan berubah.",
  }),
  emailVerification: (code) => ({
    subject: `${code} adalah kode verifikasi Katkee kamu`,
    text:
      `Kode verifikasi Katkee kamu adalah ${code}. Kode ini berlaku 30 menit.\n\n` +
      "Masukkan kode ini di aplikasi Katkee untuk memastikan ini email kamu.\n\n" +
      "Kalau kamu tidak membuat akun Katkee, abaikan email ini.",
  }),
  newDeviceLogin: (device) => ({
    subject: "Login baru ke akun Katkee kamu",
    text:
      `Akun Katkee kamu baru saja login di perangkat baru${device ? ` (${device})` : ""}.\n\n` +
      "Kalau itu kamu, tidak perlu melakukan apa pun.\n" +
      "Kalau bukan, buka Katkee → Profil → Pengaturan → Keamanan akun, pilih \"Keluar dari semua perangkat\", lalu reset kata sandimu.",
  }),
  dataExportReady: (days) => ({
    subject: "Data Katkee kamu siap diunduh",
    text:
      "Salinan data Katkee yang kamu minta sudah siap.\n\n" +
      "Buka Katkee → Profil → Pengaturan → Unduh data kamu untuk menyimpannya. " +
      `Data disimpan selama ${days} hari, lalu dihapus.\n\n` +
      "Kalau kamu tidak memintanya, ganti kata sandimu dan pilih \"Keluar dari semua perangkat\" di Keamanan akun.",
  }),
};

const fr: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} est ton code de réinitialisation Katkee`,
    text:
      `Ton code de réinitialisation du mot de passe Katkee est ${code}. Il expire dans 15 minutes.\n\n` +
      `Ouvre ce lien sur ton téléphone pour continuer : ${link}\n\n` +
      "Si tu n'as pas demandé à réinitialiser ton mot de passe, ignore cet e-mail : ton mot de passe ne changera pas.",
  }),
  emailVerification: (code) => ({
    subject: `${code} est ton code de vérification Katkee`,
    text:
      `Ton code de vérification Katkee est ${code}. Il expire dans 30 minutes.\n\n` +
      "Saisis-le dans l'app Katkee pour confirmer que c'est bien ton adresse e-mail.\n\n" +
      "Si tu n'as pas créé de compte Katkee, ignore cet e-mail.",
  }),
  newDeviceLogin: (device) => ({
    subject: "Nouvelle connexion à ton compte Katkee",
    text:
      `Ton compte Katkee vient d'être connecté sur un nouvel appareil${device ? ` (${device})` : ""}.\n\n` +
      "Si c'était toi, tu n'as rien à faire.\n" +
      "Sinon, ouvre Katkee → Profil → Paramètres → Sécurité du compte, choisis « Se déconnecter de tous les appareils » et réinitialise ton mot de passe.",
  }),
  dataExportReady: (days) => ({
    subject: "Tes données Katkee sont prêtes à être téléchargées",
    text:
      "La copie de tes données Katkee que tu as demandée est prête.\n\n" +
      "Ouvre Katkee → Profil → Paramètres → Télécharger tes données pour l'enregistrer. " +
      `Elle est conservée ${days} jours, puis supprimée.\n\n` +
      "Si tu n'as rien demandé, change ton mot de passe et choisis « Se déconnecter de tous les appareils » dans Sécurité du compte.",
  }),
};

const de: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} ist dein Code zum Zurücksetzen deines Katkee-Passworts`,
    text:
      `Dein Code zum Zurücksetzen deines Katkee-Passworts ist ${code}. Er läuft in 15 Minuten ab.\n\n` +
      `Öffne diesen Link auf deinem Handy, um fortzufahren: ${link}\n\n` +
      "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren: Dein Passwort bleibt unverändert.",
  }),
  emailVerification: (code) => ({
    subject: `${code} ist dein Katkee-Bestätigungscode`,
    text:
      `Dein Katkee-Bestätigungscode ist ${code}. Er läuft in 30 Minuten ab.\n\n` +
      "Gib ihn in der Katkee-App ein, um zu bestätigen, dass das deine E-Mail-Adresse ist.\n\n" +
      "Wenn du kein Katkee-Konto erstellt hast, kannst du diese E-Mail ignorieren.",
  }),
  newDeviceLogin: (device) => ({
    subject: "Neue Anmeldung bei deinem Katkee-Konto",
    text:
      `Bei deinem Katkee-Konto hat sich gerade jemand auf einem neuen Gerät angemeldet${device ? ` (${device})` : ""}.\n\n` +
      "Wenn du das warst, musst du nichts tun.\n" +
      "Wenn nicht, öffne Katkee → Profil → Einstellungen → Kontosicherheit, wähle „Von allen Geräten abmelden“ und setze dein Passwort zurück.",
  }),
  dataExportReady: (days) => ({
    subject: "Deine Katkee-Daten stehen zum Download bereit",
    text:
      "Die Kopie deiner Katkee-Daten, die du angefordert hast, ist fertig.\n\n" +
      "Öffne Katkee → Profil → Einstellungen → Deine Daten herunterladen, um sie zu speichern. " +
      `Sie wird ${days} Tage aufbewahrt und dann gelöscht.\n\n` +
      "Wenn du das nicht angefordert hast, ändere dein Passwort und wähle „Von allen Geräten abmelden“ in der Kontosicherheit.",
  }),
};

const ar: Templates = {
  passwordReset: (code, link) => ({
    subject: `${code} هو رمز إعادة تعيين كلمة مرور Katkee`,
    text:
      `رمز إعادة تعيين كلمة مرور Katkee هو ${code}. تنتهي صلاحيته خلال 15 دقيقة.\n\n` +
      `افتح هذا الرابط على هاتفك للمتابعة: ${link}\n\n` +
      "إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة، ولن تتغير كلمة مرورك.",
  }),
  emailVerification: (code) => ({
    subject: `${code} هو رمز التحقق في Katkee`,
    text:
      `رمز التحقق في Katkee هو ${code}. تنتهي صلاحيته خلال 30 دقيقة.\n\n` +
      "أدخله في تطبيق Katkee لتأكيد أن هذا بريدك الإلكتروني.\n\n" +
      "إذا لم تنشئ حسابًا على Katkee، يمكنك تجاهل هذه الرسالة.",
  }),
  newDeviceLogin: (device) => ({
    subject: "تسجيل دخول جديد إلى حسابك على Katkee",
    text:
      `تم تسجيل الدخول إلى حسابك على Katkee من جهاز جديد${device ? ` (${device})` : ""}.\n\n` +
      "إذا كنت أنت، فلا داعي لفعل أي شيء.\n" +
      "وإذا لم تكن أنت، افتح Katkee ← الملف الشخصي ← الإعدادات ← أمان الحساب، واختر \"تسجيل الخروج من كل الأجهزة\"، ثم أعد تعيين كلمة المرور.",
  }),
  dataExportReady: (days) => ({
    subject: "بياناتك على Katkee جاهزة للتنزيل",
    text:
      "نسخة بياناتك على Katkee التي طلبتها جاهزة.\n\n" +
      "افتح Katkee ← الملف الشخصي ← الإعدادات ← تنزيل بياناتك لحفظها. " +
      `ستبقى متاحة لمدة ${days} يومًا ثم تُحذف.\n\n` +
      "إذا لم تطلب ذلك، غيّر كلمة المرور واختر \"تسجيل الخروج من كل الأجهزة\" من أمان الحساب.",
  }),
};

export const EMAIL_TEMPLATES: Record<Locale, Templates> = { en, hi, mr, es, pt, id, fr, de, ar };
