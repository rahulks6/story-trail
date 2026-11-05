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

export const EMAIL_TEMPLATES: Record<Locale, Templates> = { en, hi, mr };
