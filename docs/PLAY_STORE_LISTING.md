# Google Play store listing (ASO)

The text to paste into Play Console (Grow users > Store presence > Main store listing), written for
search: the words people type when they look for an app like Katkee ("stories", "share stories",
"chat", "video call", "friends", "private") sit in the title, the short description and the first
lines of the full description, where Play weighs them most, and are repeated naturally (never
stuffed: Google demotes keyword lists). Everything described is in the app today.
`scripts/check-store-listing.cjs` checks each field against Play's limits.

Katkee is available worldwide. English is the default listing; Hindi, Marathi, Spanish, Portuguese,
Indonesian, French, German and Arabic are added as translations (Store presence > Main store listing > Manage translations), so people whose phones
use those languages see the listing in theirs.

## Store settings

| Field | Value |
| --- | --- |
| App category | Social |
| Tags (up to 5) | Social, Photo & video sharing, Messaging, Video calling, Friends |
| Contact email | support@katkee.com |
| Website | https://katkee.com |
| Privacy policy | https://katkee.com/privacy |
| Countries | All countries and regions |
| Ads | No (Sponsored Stories are off) |
| Target audience | 18 and over |

## Keyword plan

Play reads the app name, short description and full description for search; there is no
keyword field. Weight goes title > short description > first lines of the full description >
the rest, and repeating a word naturally 3 to 5 times in the full description helps; lists of
keywords get the listing demoted. Search volumes below are judgement, not Play data: after
launch, Play Console, Grow users, Store performance, Store analysis ("Search terms") shows the
words people really used, and the plan should follow that.

| Keyword | Why | Where it is |
| --- | --- | --- |
| stories, share stories | Katkee's core; the words people search for Story apps | Title, short, full (opening line and 8 more times) |
| chat, messages | The second reason to open the app every day | Title, short, full |
| video call, voice notes | Strong intent, less crowded than "stories" | Title (Calls), short, full |
| friends, private, close friends | What sets Katkee apart from public feeds | Short, full |
| music, stickers, filters, photo, video | Story-making searches | Full |
| Hindi / Marathi: स्टोरी, चैट, वीडियो कॉल | Many Indian users search in their own script | The hi and mr listings |

Brand searches ("katkee") match the title; the website and social posts should always say
"Katkee on Google Play" with the Play link once the app is live.

## Experiments after launch (Store listing experiments)

Play can show two versions of the listing to different visitors and report which gets more
installs (Grow users, Store presence, Store listing experiments). Run one at a time, 50/50, for
at least 7 days, and keep a winner only when Play marks it as better with confidence.

1. **First screenshot**: Home (palm beach Story) against the editor (street photo with
   "Golden hour"). The first screenshot decides most installs.
2. **Short description**: the current one against "The calm Stories app: share your day, chat and
   video call close friends."
3. **App name**: "Katkee: Stories, Chat & Calls" against "Katkee: Share Stories & Chat".
4. **Feature graphic**: the current one against one with the editor screen in front.

## Custom store listing for India

Play can show a separate listing per country (Grow users, Store presence, Custom store
listings). For India, lead with festivals: a first screenshot of a festival Story ring and a
short description such as "Share your day and every festival in Stories. Chat and video call
friends." Worth doing for Diwali, Holi and other big festivals, when people search for them.

## Ratings and reviews

- The app asks for a rating the stores' own way, after someone's third Story
  (`mobile/src/utils/reviewPrompt.ts`): never at launch, at most every 120 days.
- Reply to every review in the first weeks, within a day (Play Console, Quality, Ratings and
  reviews). Replies show on the listing and raised ratings count again.
- Fix what one-star reviews name first: rating is the strongest signal Play uses after installs.

## English (en-US), the default

### App name (30 characters max)
<!-- field:title:en -->
Katkee: Stories, Chat & Calls
<!-- /field -->

### Short description (80 characters max)
<!-- field:short:en -->
Share your day in Stories. Chat, send voice notes and video call your friends.
<!-- /field -->

### Full description (4,000 characters max)
<!-- field:full:en -->
Katkee is the Stories app for sharing your day with the people who matter. Post photos and videos as Stories, add music, text and stickers, then chat, send voice notes and video call your friends, all in one calm, private place.

No endless feed. No chasing likes. Just real moments, shared.

STORIES THAT LOOK GREAT
• Share photos and videos as Stories that last 24 hours
• Add text in beautiful styles, stickers, emoji, drawings and filters
• Pick a song from Katkee's music library to play with your Story
• Pinch to zoom, turn and move your photo until it's just right
• Trim videos, and make Layouts with up to six photos in one Story
• Polls, quizzes, questions, countdowns and links make Stories interactive
• Close Friends: share some Stories only with the people closest to you
• Keep your favourite Stories on your profile as Highlights, forever

SEE STORIES YOU'LL LOVE
• Katkee understands what each Story is about, so no tagging is needed
• Your Home fills with Stories from friends and topics you enjoy
• Explore popular Stories and find new people to follow
• Celebrate festivals together with festival Stories from everyone

CHAT AND CALL YOUR FRIENDS
• Private messages and group chats with up to 32 people
• Voice notes, photos and videos in your chats
• Voice and video calls
• Reply to a Story privately, react with an emoji, or double tap to like
• See when messages are sent, delivered and seen

PRIVATE AND SAFE BY DESIGN
• We never sell your data, and there is no ad tracking
• Choose who sees each Story: everyone, followers only or Close Friends
• Make your account private, and approve who follows you
• Two-step login protects your account
• Block, mute and report anyone, at any time
• Download a copy of your data, or delete your account, whenever you like

MADE FOR EVERYONE
• Available worldwide, in English, Hindi and Marathi
• Light and dark mode
• Picture descriptions so people who use a screen reader can enjoy every Story
• Several accounts on one phone, switch in one tap

Katkee is for people aged 18 and over.

Questions or ideas? Write to support@katkee.com or visit katkee.com/support.
Privacy Policy: katkee.com/privacy · Terms: katkee.com/terms
<!-- /field -->

## Hindi (hi-IN)

### App name
<!-- field:title:hi -->
Katkee: स्टोरीज़, चैट और कॉल
<!-- /field -->

### Short description
<!-- field:short:hi -->
अपना दिन स्टोरीज़ में शेयर करें। दोस्तों से चैट, वॉइस नोट और वीडियो कॉल करें।
<!-- /field -->

### Full description
<!-- field:full:hi -->
Katkee स्टोरीज़ ऐप है, जिससे आप अपना दिन उन लोगों के साथ शेयर करते हैं जो आपके लिए मायने रखते हैं। फ़ोटो और वीडियो स्टोरीज़ के रूप में पोस्ट करें, म्यूज़िक, टेक्स्ट और स्टिकर जोड़ें, फिर दोस्तों से चैट करें, वॉइस नोट भेजें और वीडियो कॉल करें, सब एक शांत और निजी जगह पर।

कोई अंतहीन फ़ीड नहीं। लाइक के पीछे भागना नहीं। बस असली पल, शेयर किए हुए।

ख़ूबसूरत स्टोरीज़
• फ़ोटो और वीडियो स्टोरीज़ शेयर करें, जो 24 घंटे तक रहती हैं
• सुंदर स्टाइल में टेक्स्ट, स्टिकर, इमोजी, ड्रॉइंग और फ़िल्टर जोड़ें
• Katkee की म्यूज़िक लाइब्रेरी से अपनी स्टोरी के लिए गाना चुनें
• फ़ोटो को ज़ूम करें, घुमाएँ और सही जगह पर रखें
• वीडियो ट्रिम करें, और एक स्टोरी में छह फ़ोटो तक के लेआउट बनाएँ
• पोल, क्विज़, सवाल, काउंटडाउन और लिंक से स्टोरीज़ को इंटरैक्टिव बनाएँ
• क्लोज़ फ़्रेंड्स: कुछ स्टोरीज़ सिर्फ़ अपने सबसे क़रीबी लोगों के साथ शेयर करें
• पसंदीदा स्टोरीज़ को हाइलाइट्स के रूप में हमेशा अपनी प्रोफ़ाइल पर रखें

आपको पसंद आने वाली स्टोरीज़
• Katkee समझता है कि हर स्टोरी किस बारे में है, टैग करने की ज़रूरत नहीं
• आपका होम दोस्तों और आपके पसंदीदा विषयों की स्टोरीज़ से भरता है
• लोकप्रिय स्टोरीज़ देखें और फ़ॉलो करने के लिए नए लोग खोजें
• त्योहारों की स्टोरीज़ के साथ सब मिलकर त्योहार मनाएँ

दोस्तों से चैट और कॉल
• निजी मैसेज और 32 लोगों तक के ग्रुप चैट
• चैट में वॉइस नोट, फ़ोटो और वीडियो
• वॉइस और वीडियो कॉल
• किसी स्टोरी का निजी जवाब दें, इमोजी से रिएक्ट करें या डबल टैप से लाइक करें

निजी और सुरक्षित
• हम आपका डेटा कभी नहीं बेचते, और कोई विज्ञापन ट्रैकिंग नहीं
• हर स्टोरी के लिए चुनें कि कौन देखे: सब, सिर्फ़ फ़ॉलोअर या क्लोज़ फ़्रेंड्स
• प्राइवेट अकाउंट, और फ़ॉलो करने वालों को आप मंज़ूरी दें
• टू-स्टेप लॉगिन से अकाउंट सुरक्षित रखें
• किसी को भी ब्लॉक, म्यूट या रिपोर्ट करें
• अपने डेटा की कॉपी डाउनलोड करें या अकाउंट कभी भी डिलीट करें

सभी के लिए
• पूरी दुनिया में उपलब्ध, अंग्रेज़ी, हिंदी और मराठी में
• लाइट और डार्क मोड
• एक फ़ोन पर कई अकाउंट, एक टैप में बदलें

Katkee 18 साल और उससे ज़्यादा उम्र के लोगों के लिए है।

सवाल या सुझाव? support@katkee.com पर लिखें या katkee.com/support पर जाएँ।
<!-- /field -->

## Marathi (mr-IN)

### App name
<!-- field:title:mr -->
Katkee: स्टोरीज, चॅट आणि कॉल
<!-- /field -->

### Short description
<!-- field:short:mr -->
तुमचा दिवस स्टोरीजमध्ये शेअर करा. मित्रांशी चॅट, व्हॉइस नोट आणि व्हिडिओ कॉल करा.
<!-- /field -->

### Full description
<!-- field:full:mr -->
Katkee हे स्टोरीज ॲप आहे, ज्यातून तुम्ही तुमचा दिवस तुमच्यासाठी महत्त्वाच्या लोकांसोबत शेअर करता. फोटो आणि व्हिडिओ स्टोरीज म्हणून पोस्ट करा, संगीत, टेक्स्ट आणि स्टिकर जोडा, मग मित्रांशी चॅट करा, व्हॉइस नोट पाठवा आणि व्हिडिओ कॉल करा, सगळं एका शांत आणि खाजगी ठिकाणी.

अंतहीन फीड नाही. लाइकच्या मागे धावणं नाही. फक्त खरे क्षण, शेअर केलेले.

सुंदर स्टोरीज
• फोटो आणि व्हिडिओ स्टोरीज शेअर करा, ज्या 24 तास राहतात
• सुंदर शैलीत टेक्स्ट, स्टिकर, इमोजी, ड्रॉइंग आणि फिल्टर जोडा
• Katkee च्या संगीत लायब्ररीतून तुमच्या स्टोरीसाठी गाणं निवडा
• फोटो झूम करा, फिरवा आणि हवा तसा ठेवा
• व्हिडिओ ट्रिम करा, आणि एका स्टोरीत सहा फोटोपर्यंतचे लेआउट बनवा
• पोल, क्विझ, प्रश्न, काउंटडाउन आणि लिंकने स्टोरीज इंटरॅक्टिव्ह बनवा
• क्लोज फ्रेंड्स: काही स्टोरीज फक्त जवळच्या लोकांसोबत शेअर करा
• आवडत्या स्टोरीज हायलाइट्स म्हणून कायम प्रोफाइलवर ठेवा

तुम्हाला आवडतील अशा स्टोरीज
• Katkee प्रत्येक स्टोरी कशाबद्दल आहे हे समजतं, टॅग करायची गरज नाही
• तुमचं होम मित्रांच्या आणि आवडत्या विषयांच्या स्टोरीजने भरतं
• लोकप्रिय स्टोरीज पाहा आणि फॉलो करण्यासाठी नवीन लोक शोधा
• सणांच्या स्टोरीजसह सगळे मिळून सण साजरे करा

मित्रांशी चॅट आणि कॉल
• खाजगी मेसेज आणि 32 लोकांपर्यंतचे ग्रुप चॅट
• चॅटमध्ये व्हॉइस नोट, फोटो आणि व्हिडिओ
• व्हॉइस आणि व्हिडिओ कॉल
• स्टोरीला खाजगी उत्तर द्या, इमोजीने रिॲक्ट करा किंवा डबल टॅपने लाइक करा

खाजगी आणि सुरक्षित
• आम्ही तुमचा डेटा कधीही विकत नाही, आणि जाहिरात ट्रॅकिंग नाही
• प्रत्येक स्टोरी कोण पाहील ते निवडा: सगळे, फक्त फॉलोअर किंवा क्लोज फ्रेंड्स
• प्रायव्हेट अकाउंट, आणि फॉलो करणाऱ्यांना तुम्ही मंजुरी द्या
• टू-स्टेप लॉगिनने अकाउंट सुरक्षित ठेवा
• कोणालाही ब्लॉक, म्यूट किंवा रिपोर्ट करा
• तुमच्या डेटाची कॉपी डाउनलोड करा किंवा अकाउंट कधीही डिलीट करा

सर्वांसाठी
• जगभर उपलब्ध, इंग्रजी, हिंदी आणि मराठीत
• लाइट आणि डार्क मोड
• एका फोनवर अनेक अकाउंट, एका टॅपमध्ये बदला

Katkee 18 वर्षे आणि त्याहून अधिक वयाच्या लोकांसाठी आहे.

प्रश्न किंवा कल्पना? support@katkee.com वर लिहा किंवा katkee.com/support ला भेट द्या.
<!-- /field -->

## More languages (worldwide)

Play shows people the listing in their phone's language when there is one, and search matches
the words of that language. These six cover most of Android's largest markets outside India.
The app itself is in English, Hindi and Marathi; each description says so, so nobody expects
the app in their language.

### Spanish, Latin America (es-419)
<!-- field:title:es -->
Katkee: Historias y Chat
<!-- /field -->
<!-- field:short:es -->
Comparte tu día en Historias. Chatea, envía notas de voz y haz videollamadas.
<!-- /field -->
<!-- field:full:es -->
Katkee es la app de Historias para compartir tu día con las personas que importan. Publica fotos y videos como Historias con música, texto y stickers, y luego chatea, envía notas de voz y haz videollamadas con tus amigos, todo en un lugar tranquilo y privado.

Sin feed infinito. Sin perseguir likes. Solo momentos reales.

HISTORIAS QUE SE VEN INCREÍBLES
• Historias de fotos y videos que duran 24 horas
• Texto, stickers, emojis, dibujos, filtros y música
• Acerca, gira y mueve tu foto hasta que quede perfecta
• Recorta videos y crea Layouts con hasta seis fotos
• Encuestas, preguntas, cuentas regresivas y enlaces
• Mejores amigos: comparte algunas Historias solo con tu círculo cercano
• Guarda tus favoritas como Destacadas en tu perfil

CHATEA Y LLAMA
• Mensajes privados y chats grupales de hasta 32 personas
• Notas de voz, fotos y videos
• Llamadas de voz y videollamadas

PRIVADA Y SEGURA
• Nunca vendemos tus datos, sin rastreo publicitario
• Tú eliges quién ve cada Historia
• Cuenta privada, inicio de sesión en dos pasos, bloquear y reportar

La app está en inglés, hindi y maratí. Para mayores de 18 años.
Ayuda: support@katkee.com · Privacidad: katkee.com/privacy
<!-- /field -->

### Portuguese, Brazil (pt-BR)
<!-- field:title:pt -->
Katkee: Stories, Chat e Vídeo
<!-- /field -->
<!-- field:short:pt -->
Compartilhe seu dia em Stories. Converse, mande áudios e faça chamadas de vídeo.
<!-- /field -->
<!-- field:full:pt -->
Katkee é o app de Stories para compartilhar seu dia com quem importa. Publique fotos e vídeos como Stories com música, texto e figurinhas, depois converse, mande áudios e faça chamadas de vídeo com seus amigos, tudo em um lugar tranquilo e privado.

Sem feed infinito. Sem correr atrás de curtidas. Só momentos reais.

STORIES LINDOS
• Stories de fotos e vídeos que duram 24 horas
• Texto, figurinhas, emojis, desenhos, filtros e música
• Aproxime, gire e mova sua foto até ficar perfeita
• Corte vídeos e crie Layouts com até seis fotos
• Enquetes, perguntas, contagens regressivas e links
• Melhores Amigos: alguns Stories só para quem é mais próximo
• Guarde os favoritos como Destaques no seu perfil

CONVERSE E LIGUE
• Mensagens privadas e grupos de até 32 pessoas
• Áudios, fotos e vídeos
• Chamadas de voz e de vídeo

PRIVADO E SEGURO
• Nunca vendemos seus dados, sem rastreamento de anúncios
• Você escolhe quem vê cada Story
• Conta privada, login em duas etapas, bloquear e denunciar

O app está em inglês, hindi e marati. Para maiores de 18 anos.
Ajuda: support@katkee.com · Privacidade: katkee.com/privacy
<!-- /field -->

### Indonesian (id)
<!-- field:title:id -->
Katkee: Stories & Chat Teman
<!-- /field -->
<!-- field:short:id -->
Bagikan harimu lewat Stories. Chat, kirim pesan suara, dan video call teman.
<!-- /field -->
<!-- field:full:id -->
Katkee adalah aplikasi Stories untuk berbagi harimu dengan orang-orang terdekat. Unggah foto dan video sebagai Stories dengan musik, teks, dan stiker, lalu chat, kirim pesan suara, dan video call dengan teman, semua di tempat yang tenang dan privat.

Tanpa feed tanpa akhir. Tanpa mengejar like. Hanya momen nyata.

STORIES YANG MEMUKAU
• Stories foto dan video yang bertahan 24 jam
• Teks, stiker, emoji, gambar, filter, dan musik
• Perbesar, putar, dan geser foto sampai pas
• Potong video dan buat Layout hingga enam foto
• Polling, pertanyaan, hitung mundur, dan tautan
• Teman Dekat: bagikan Stories tertentu hanya untuk orang terdekat
• Simpan favoritmu sebagai Sorotan di profil

CHAT DAN TELEPON
• Pesan pribadi dan grup chat hingga 32 orang
• Pesan suara, foto, dan video
• Telepon suara dan video call

PRIVAT DAN AMAN
• Kami tidak pernah menjual datamu, tanpa pelacakan iklan
• Kamu pilih siapa yang melihat setiap Story
• Akun privat, login dua langkah, blokir dan laporkan

Aplikasi tersedia dalam bahasa Inggris, Hindi, dan Marathi. Untuk usia 18 tahun ke atas.
Bantuan: support@katkee.com · Privasi: katkee.com/privacy
<!-- /field -->

### French (fr-FR)
<!-- field:title:fr -->
Katkee: Stories, Chat, Appels
<!-- /field -->
<!-- field:short:fr -->
Partagez votre journée en Stories. Discutez, vocaux et appels vidéo entre amis.
<!-- /field -->
<!-- field:full:fr -->
Katkee est l'app de Stories pour partager votre journée avec ceux qui comptent. Publiez photos et vidéos en Stories avec musique, texte et stickers, puis discutez, envoyez des messages vocaux et passez des appels vidéo, dans un espace calme et privé.

Pas de fil sans fin. Pas de course aux likes. Juste de vrais moments.

DES STORIES QUI EN JETTENT
• Stories photo et vidéo qui durent 24 heures
• Texte, stickers, emojis, dessins, filtres et musique
• Zoomez, tournez et déplacez votre photo
• Coupez vos vidéos et créez des Layouts jusqu'à six photos
• Sondages, questions, comptes à rebours et liens
• Amis proches : certaines Stories pour vos proches seulement
• Gardez vos préférées à la une sur votre profil

DISCUTER ET APPELER
• Messages privés et groupes jusqu'à 32 personnes
• Vocaux, photos et vidéos
• Appels audio et vidéo

PRIVÉE ET SÛRE
• Nous ne vendons jamais vos données, aucun pistage publicitaire
• Vous choisissez qui voit chaque Story
• Compte privé, connexion en deux étapes, bloquer et signaler

L'app est en anglais, hindi et marathi. Réservée aux plus de 18 ans.
Aide : support@katkee.com · Confidentialité : katkee.com/privacy
<!-- /field -->

### German (de-DE)
<!-- field:title:de -->
Katkee: Stories, Chat & Anrufe
<!-- /field -->
<!-- field:short:de -->
Teile deinen Tag in Stories. Chatte, sende Sprachnachrichten, mach Videoanrufe.
<!-- /field -->
<!-- field:full:de -->
Katkee ist die Stories-App, um deinen Tag mit den Menschen zu teilen, die dir wichtig sind. Poste Fotos und Videos als Stories mit Musik, Text und Stickern, dann chatte, sende Sprachnachrichten und führe Videoanrufe, alles an einem ruhigen, privaten Ort.

Kein endloser Feed. Keine Jagd nach Likes. Nur echte Momente.

STORIES, DIE BEGEISTERN
• Foto- und Video-Stories, die 24 Stunden bleiben
• Text, Sticker, Emojis, Zeichnungen, Filter und Musik
• Zoomen, drehen und verschieben, bis dein Foto passt
• Videos kürzen und Layouts mit bis zu sechs Fotos
• Umfragen, Fragen, Countdowns und Links
• Enge Freunde: manche Stories nur für die Liebsten
• Lieblings-Stories als Highlights im Profil

CHATTEN UND ANRUFEN
• Private Nachrichten und Gruppenchats mit bis zu 32 Personen
• Sprachnachrichten, Fotos und Videos
• Sprach- und Videoanrufe

PRIVAT UND SICHER
• Wir verkaufen nie deine Daten, kein Werbe-Tracking
• Du entscheidest, wer jede Story sieht
• Privates Konto, Anmeldung in zwei Schritten, blockieren und melden

Die App ist auf Englisch, Hindi und Marathi. Ab 18 Jahren.
Hilfe: support@katkee.com · Datenschutz: katkee.com/privacy
<!-- /field -->

### Arabic (ar)
<!-- field:title:ar -->
Katkee: قصص ودردشة ومكالمات
<!-- /field -->
<!-- field:short:ar -->
شارك يومك في القصص. دردش، أرسل رسائل صوتية، واتصل بأصدقائك بالفيديو.
<!-- /field -->
<!-- field:full:ar -->
Katkee هو تطبيق القصص لمشاركة يومك مع الأشخاص المهمين لك. انشر الصور والفيديوهات كقصص مع الموسيقى والنص والملصقات، ثم دردش وأرسل رسائل صوتية واتصل بأصدقائك بالفيديو، في مكان هادئ وخاص.

بلا خلاصة لا تنتهي. بلا سباق على الإعجابات. لحظات حقيقية فقط.

قصص رائعة
• قصص صور وفيديو تبقى 24 ساعة
• نص وملصقات ورموز تعبيرية ورسم وفلاتر وموسيقى
• كبّر صورتك وأدرها وحرّكها حتى تصبح مثالية
• قصّ الفيديو وأنشئ تنسيقات تضم حتى ست صور
• استطلاعات وأسئلة وعدّ تنازلي وروابط
• الأصدقاء المقربون: شارك بعض القصص مع المقربين فقط
• احتفظ بقصصك المفضلة كأبرز اللحظات في ملفك

دردشة ومكالمات
• رسائل خاصة ومجموعات حتى 32 شخصًا
• رسائل صوتية وصور وفيديو
• مكالمات صوتية ومرئية

خاص وآمن
• لا نبيع بياناتك أبدًا، ولا تتبع إعلاني
• أنت تختار من يرى كل قصة
• حساب خاص، تسجيل دخول بخطوتين، الحظر والإبلاغ

التطبيق متاح بالإنجليزية والهندية والماراثية. لمن هم في سن 18 عامًا فأكثر.
المساعدة: support@katkee.com · الخصوصية: katkee.com/privacy
<!-- /field -->

## Graphics (ready to upload)

| Asset | Size | File |
| --- | --- | --- |
| App icon | 512 x 512 PNG | `brand/store/google-play-icon-512.png` |
| Feature graphic | 1024 x 500 PNG | `brand/store/google-play-feature-graphic-1024x500.png` |
| Phone screenshots (8) | 1080 x 1920 PNG | `brand/store/screenshots/phone/01-home.png` … `08-settings.png` (English and the six other languages); `phone-hi/`, `phone-mr/` for Hindi and Marathi |
| 7-inch and 10-inch tablet screenshots (8) | 1920 x 1080 PNG | `brand/store/screenshots/tablet/…`; `tablet-hi/`, `tablet-mr/` |

Upload them in their numbered order: Play shows the first three without scrolling. They are the
real app (Android emulator, flow=store on the emulator workflow, with demo accounts and photos;
see `brand/store/photos/SOURCES.md`), framed by `brand/store/screenshots/make.cjs`; the feature
graphic by `brand/store/make-feature-graphic.cjs`. To make them again after a design change:
run the workflow with flow=store, copy the screens into `brand/store/screenshots/raw/`, then
run both scripts.
