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
| Tags (up to 5) | Social, Communication, Photography, Text messaging, Video call |
| Contact email | support@katkee.com |
| Website | https://katkee.com |
| Privacy policy | https://katkee.com/privacy |
| Countries | All countries and regions |
| Ads | No (Sponsored Stories are off) |
| Target audience | 18 and over |

## Keyword plan (updated 24 November 2026)

Play reads the title (strongest), the short description (next) and the full description; there
is no keyword field. The priorities below come from Google's search suggestions for India (603
real searches pulled for 60 seed phrases, 24 Nov 2026) and from what ranks on Play: "status" is
searched far more than "stories" in India, so it now leads the title in English, Hindi and
Marathi. Repeat a keyword naturally, about once per 250 characters; never stuff.

| Priority | Keyword | Where it is |
| --- | --- | --- |
| 1 | status | Title (first word after Katkee), short, full ("photo status", "video status", "status with songs", "festival status") |
| 1 | status with songs / with music | Short, full (opening line and a section heading) |
| 1 | stories, story | Title, short, full |
| 1 | close friends | Short, full (opening line and 3 more) |
| 1 | chat, video call, voice notes | Title, short, full |
| 2 | photo status, video status, story maker | Full |
| 2 | private social app, friends only, no Reels feed | Full |
| 2 | comments: like, reply, tag with @ | Full (new section) |
| 3 | festival status (Diwali, Holi, Eid, Christmas; Ganeshotsav in Marathi) | Full; seasonal Custom store listings |
| 3 | Hindi, Marathi (people search "Hindi status", "Marathi status") | Full |
| Hindi | स्टेटस, गानों के साथ स्टेटस, फ़ोटो स्टेटस, वीडियो स्टेटस, स्टोरी, क्लोज़ फ़्रेंड्स | The hi listing |
| Marathi | स्टेटस, गाण्यांसह स्टेटस, फोटो स्टेटस, व्हिडिओ स्टेटस, स्टोरी, क्लोज फ्रेंड्स | The mr listing |

After the listing has been live 2-3 weeks, Play Console → Grow users → Store performance →
Store analysis → Search terms shows the words that really bring visitors and installers: move
the best of them up and drop what brings nothing.

## Do these in Play Console (once)

1. **Target audience: 18 and over only** (Policy → App content → Target audience and content).
   The listing showed "Rated for 12+", which brings teenagers who install and can't sign up.
2. **Promo video:** upload the 15-second app demo (`brand/promo`, 16:9 version) to YouTube,
   public or unlisted, with ads off, and paste the link in Store listing → Video.
3. **Tags:** Social, Communication, Photography, Video call, Text messaging (Store settings).
4. **Website:** https://katkee.com, so the listing links to the blog and guides.
5. **Reply to every review** within a day.

## Custom store listing: India (country-based)

Play Console → Grow users → Store presence → Custom store listings → Create → Country/region:
India. English speakers in India then see this text instead of the main listing (Hindi and
Marathi phones keep their translations). Same screenshots.

- **Short description (80):** `Status & Stories with songs for close friends. Chat, voice notes, video calls.`
- **Full description:** the English one above, with the first line changed to: "Katkee is a
  made-in-India Stories and status app for your close friends: photo status, video status with
  songs, festival status for Diwali, Holi and Eid, and chats, voice notes and video calls with
  the people who matter."

## Experiments after launch (Store listing experiments)

Play can show two versions of the listing to different visitors and report which gets more
installs (Grow users, Store presence, Store listing experiments). Run one at a time, 50/50, for
at least 7 days, and keep a winner only when Play marks it as better with confidence.

1. **Short description**: the current one against "Status with songs for your close friends.
   Private Stories, chat and video calls." (78 characters).
2. **First screenshot**: Home (a Story with a song) against the editor with the music picker open.
3. **App name**: "Katkee: Status, Stories & Chat" against "Katkee: Status with Songs & Chat".
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
Katkee: Status, Stories & Chat
<!-- /field -->

### Short description (80 characters max)
<!-- field:short:en -->
Status with songs & Stories for close friends. Chat, voice notes, video calls.
<!-- /field -->

### Full description (4,000 characters max)
<!-- field:full:en -->
Status with songs and Stories for your close friends, not for strangers. Make a photo status or video status with music in seconds, choose exactly who sees it, then chat, send voice notes and video call the same friends. A private social app, made in India, in English, Hindi, Marathi and six more languages.

Katkee is a Stories and status app for the people you actually know. Every Story lasts 24 hours, like a status: add a song, text and animated stickers, and share it with everyone, your followers or only your Close Friends.

Why people choose Katkee
• Close Friends: share some Stories only with your inner circle
• You choose who sees every Story and status, each time you post
• Your friends' Stories first on Home, one swipe at a time, with no public Reels feed
• Free, with no ad tracking, and we never sell your data

Status with music, made in seconds
• Photo status and video status that last 24 hours
• Status with songs: add music from Katkee's library and pick the best part
• Story maker: text styles, animated stickers, GIFs, emoji, drawing and filters
• Layouts: a photo collage of up to six photos in one Story
• Polls, quizzes, questions, countdowns, links and Add Yours chains
• Festival status: Katkee spots Diwali, Holi, Eid, Christmas and more and adds your Story to the festival ring
• Today's theme: an easy idea for your status every evening

Comments, likes and replies
• Like a Story with a double tap, or comment on it
• Like comments, reply to them, and tag friends with @
• Reply to a Story privately in chat, or react with an emoji

Highlights that last
• Keep your best Stories on your profile as Highlights
• Friends can like, comment on and share your Highlights
• Your private Archive keeps every Story you've posted, only for you

Chat, voice notes and video calls
• Private chats and group chats with up to 32 friends
• Voice notes, photos and videos in every chat
• Voice calls and video calls
• Share your Story to WhatsApp in one tap
• Invite friends with your own link, and find friends from your contacts

Easy to start
• Join in one tap with Google
• Follow friends in one tap, then share your first Story with a song
• Log in with your email or your username

Safe and private social app
• Private account: approve who follows you
• Two-step login protects your account
• Block, mute and report anyone, any time
• Stories and profile photos are checked for nudity automatically
• Download your data, or delete your account whenever you like

Made in India, for everyone
• Use Katkee in Hindi, Marathi, English, Spanish, Portuguese, Indonesian, French, German and Arabic
• Light and dark mode
• Several accounts on one phone
• Picture descriptions for screen reader users

Katkee is for people aged 18 and over.
Questions or ideas? support@katkee.com · katkee.com/support
Privacy Policy: katkee.com/privacy · Terms: katkee.com/terms
<!-- /field -->

## Hindi (hi-IN)

### App name
<!-- field:title:hi -->
Katkee: स्टेटस, स्टोरी और चैट
<!-- /field -->

### Short description
<!-- field:short:hi -->
गानों के साथ स्टेटस और स्टोरी, सिर्फ़ क्लोज़ फ़्रेंड्स के लिए। चैट, वीडियो कॉल।
<!-- /field -->

### Full description
<!-- field:full:hi -->
गानों के साथ स्टेटस और स्टोरी, अनजान लोगों के लिए नहीं, आपके क्लोज़ फ़्रेंड्स के लिए। म्यूज़िक के साथ फ़ोटो स्टेटस या वीडियो स्टेटस सेकंडों में बनाएँ, तय करें कि उसे कौन देखे, और फिर उन्हीं दोस्तों से चैट करें, वॉइस नोट भेजें और वीडियो कॉल करें। भारत में बना एक प्राइवेट सोशल ऐप, हिंदी, मराठी, अंग्रेज़ी और छह और भाषाओं में।

Katkee आपके अपने लोगों के लिए स्टोरी और स्टेटस ऐप है। हर स्टोरी स्टेटस की तरह 24 घंटे रहती है: गाना, टेक्स्ट और एनिमेटेड स्टिकर जोड़ें, और उसे सबके साथ, अपने फ़ॉलोअर्स के साथ या सिर्फ़ क्लोज़ फ़्रेंड्स के साथ शेयर करें।

लोग Katkee क्यों चुनते हैं
• क्लोज़ फ़्रेंड्स: कुछ स्टोरी सिर्फ़ ख़ास लोगों के लिए
• हर स्टोरी और स्टेटस के लिए आप चुनें कि कौन देखे
• होम पर पहले दोस्तों की स्टोरी, एक बार में एक स्वाइप, कोई पब्लिक रील्स फ़ीड नहीं
• मुफ़्त, कोई ऐड ट्रैकिंग नहीं, और हम आपका डेटा कभी नहीं बेचते

गानों के साथ स्टेटस, सेकंडों में
• फ़ोटो स्टेटस और वीडियो स्टेटस जो 24 घंटे रहते हैं
• गाने वाला स्टेटस: Katkee की म्यूज़िक लाइब्रेरी से गाना जोड़ें और उसका बेस्ट हिस्सा चुनें
• स्टोरी मेकर: टेक्स्ट स्टाइल, एनिमेटेड स्टिकर, GIF, इमोजी, ड्रॉइंग और फ़िल्टर
• लेआउट: एक स्टोरी में छह फ़ोटो तक का कोलाज
• पोल, क्विज़, सवाल, काउंटडाउन, लिंक और Add Yours
• त्योहार स्टेटस: Katkee दिवाली, होली, ईद, क्रिसमस और दूसरे त्योहार पहचानकर आपकी स्टोरी त्योहार रिंग में जोड़ता है
• आज की थीम: हर शाम स्टेटस के लिए एक आसान आइडिया

कमेंट, लाइक और जवाब
• डबल टैप से स्टोरी लाइक करें या कमेंट करें
• कमेंट लाइक करें, उनका जवाब दें और @ से दोस्तों को टैग करें
• चैट में स्टोरी का प्राइवेट जवाब दें या इमोजी से रिएक्ट करें

हमेशा रहने वाली हाइलाइट्स
• अपनी बेस्ट स्टोरी प्रोफ़ाइल पर हाइलाइट्स में रखें
• दोस्त आपकी हाइलाइट्स लाइक, कमेंट और शेयर कर सकते हैं
• आपका प्राइवेट आर्काइव हर पुरानी स्टोरी सिर्फ़ आपके लिए रखता है

चैट, वॉइस नोट और वीडियो कॉल
• प्राइवेट चैट और 32 दोस्तों तक के ग्रुप चैट
• हर चैट में वॉइस नोट, फ़ोटो और वीडियो
• वॉइस कॉल और वीडियो कॉल
• एक टैप में अपनी स्टोरी WhatsApp पर शेयर करें
• अपने इनवाइट लिंक से दोस्तों को बुलाएँ, और कॉन्टैक्ट्स से दोस्त ढूँढें

शुरुआत आसान
• Google से एक टैप में जुड़ें
• एक टैप में दोस्तों को फ़ॉलो करें और गाने के साथ पहली स्टोरी शेयर करें
• ईमेल या यूज़रनेम से लॉग इन करें

सुरक्षित और प्राइवेट सोशल ऐप
• प्राइवेट अकाउंट: तय करें कौन आपको फ़ॉलो करे
• टू-स्टेप लॉगिन से अकाउंट सुरक्षित
• किसी को भी ब्लॉक, म्यूट या रिपोर्ट करें
• स्टोरी और प्रोफ़ाइल फ़ोटो में न्यूडिटी अपने-आप जाँची जाती है
• अपने डेटा की कॉपी डाउनलोड करें, या जब चाहें अकाउंट डिलीट करें

भारत में बना, सबके लिए
• हिंदी, मराठी, अंग्रेज़ी और छह और भाषाओं में
• लाइट और डार्क मोड
• एक फ़ोन पर कई अकाउंट
• स्क्रीन रीडर इस्तेमाल करने वालों के लिए तस्वीरों का विवरण

Katkee 18 साल और उससे ज़्यादा उम्र के लोगों के लिए है।
सवाल या सुझाव? support@katkee.com · katkee.com/support
प्राइवेसी पॉलिसी: katkee.com/privacy · शर्तें: katkee.com/terms
<!-- /field -->

## Marathi (mr-IN)

### App name
<!-- field:title:mr -->
Katkee: स्टेटस, स्टोरी आणि चॅट
<!-- /field -->

### Short description
<!-- field:short:mr -->
गाण्यांसह स्टेटस आणि स्टोरी, फक्त क्लोज फ्रेंड्ससाठी. चॅट आणि व्हिडिओ कॉल.
<!-- /field -->

### Full description
<!-- field:full:mr -->
गाण्यांसह स्टेटस आणि स्टोरी, अनोळखी लोकांसाठी नाही, तुमच्या क्लोज फ्रेंड्ससाठी. संगीतासह फोटो स्टेटस किंवा व्हिडिओ स्टेटस काही सेकंदांत बनवा, ते कोण पाहील ते ठरवा, आणि मग त्याच मित्रांशी चॅट करा, व्हॉइस नोट पाठवा आणि व्हिडिओ कॉल करा. भारतात बनलेले प्रायव्हेट सोशल ॲप, मराठी, हिंदी, इंग्रजी आणि आणखी सहा भाषांमध्ये.

Katkee तुमच्या आपल्या माणसांसाठी स्टोरी आणि स्टेटस ॲप आहे. प्रत्येक स्टोरी स्टेटससारखी 24 तास राहते: गाणं, टेक्स्ट आणि ॲनिमेटेड स्टिकर जोडा, आणि ती सगळ्यांसोबत, तुमच्या फॉलोअर्ससोबत किंवा फक्त क्लोज फ्रेंड्ससोबत शेअर करा.

लोक Katkee का निवडतात
• क्लोज फ्रेंड्स: काही स्टोरीज फक्त खास लोकांसाठी
• प्रत्येक स्टोरी आणि स्टेटससाठी कोण पाहील ते तुम्ही ठरवा
• होमवर आधी मित्रांच्या स्टोरीज, एका वेळी एक स्वाइप, कोणताही पब्लिक रील्स फीड नाही
• मोफत, कोणतंही ॲड ट्रॅकिंग नाही, आणि आम्ही तुमचा डेटा कधीच विकत नाही

गाण्यांसह स्टेटस, काही सेकंदांत
• 24 तास राहणारे फोटो स्टेटस आणि व्हिडिओ स्टेटस
• गाण्याचं स्टेटस: Katkee च्या संगीत लायब्ररीतून गाणं जोडा आणि त्याचा बेस्ट भाग निवडा
• स्टोरी मेकर: टेक्स्ट स्टाइल, ॲनिमेटेड स्टिकर, GIF, इमोजी, ड्रॉइंग आणि फिल्टर
• लेआउट: एका स्टोरीत सहा फोटोपर्यंतचा कोलाज
• पोल, क्विझ, प्रश्न, काउंटडाउन, लिंक आणि Add Yours
• सणांचं स्टेटस: Katkee दिवाळी, होळी, गणेशोत्सव, ईद, ख्रिसमस ओळखून तुमची स्टोरी सणाच्या रिंगमध्ये जोडतो
• आजची थीम: रोज संध्याकाळी स्टेटससाठी एक सोपी कल्पना

कमेंट, लाइक आणि उत्तरं
• डबल टॅपने स्टोरी लाइक करा किंवा कमेंट करा
• कमेंट लाइक करा, उत्तर द्या आणि @ ने मित्रांना टॅग करा
• चॅटमध्ये स्टोरीला प्रायव्हेट उत्तर द्या किंवा इमोजीने रिॲक्ट करा

कायम राहणाऱ्या हायलाइट्स
• तुमच्या बेस्ट स्टोरीज प्रोफाइलवर हायलाइट्समध्ये ठेवा
• मित्र तुमच्या हायलाइट्स लाइक, कमेंट आणि शेअर करू शकतात
• तुमचं प्रायव्हेट आर्काइव्ह प्रत्येक जुनी स्टोरी फक्त तुमच्यासाठी ठेवतं

चॅट, व्हॉइस नोट आणि व्हिडिओ कॉल
• प्रायव्हेट चॅट आणि 32 मित्रांपर्यंतचे ग्रुप चॅट
• प्रत्येक चॅटमध्ये व्हॉइस नोट, फोटो आणि व्हिडिओ
• व्हॉइस कॉल आणि व्हिडिओ कॉल
• एका टॅपमध्ये तुमची स्टोरी WhatsApp वर शेअर करा
• तुमच्या इनव्हाइट लिंकने मित्रांना बोलवा, आणि कॉन्टॅक्ट्समधून मित्र शोधा

सोपी सुरुवात
• Google ने एका टॅपमध्ये जॉइन व्हा
• एका टॅपमध्ये मित्रांना फॉलो करा आणि गाण्यासह पहिली स्टोरी शेअर करा
• ईमेल किंवा यूज़रनेमने लॉग इन करा

सुरक्षित आणि प्रायव्हेट सोशल ॲप
• प्रायव्हेट अकाउंट: तुम्हाला कोण फॉलो करेल ते ठरवा
• टू-स्टेप लॉगिनने अकाउंट सुरक्षित
• कोणालाही ब्लॉक, म्यूट किंवा रिपोर्ट करा
• स्टोरी आणि प्रोफाइल फोटोमधली न्यूडिटी आपोआप तपासली जाते
• तुमच्या डेटाची कॉपी डाउनलोड करा, किंवा हवं तेव्हा अकाउंट डिलीट करा

भारतात बनलेलं, सगळ्यांसाठी
• मराठी, हिंदी, इंग्रजी आणि आणखी सहा भाषांमध्ये
• लाइट आणि डार्क मोड
• एका फोनवर अनेक अकाउंट
• स्क्रीन रीडर वापरणाऱ्यांसाठी चित्रांचं वर्णन

Katkee 18 वर्षे आणि त्याहून अधिक वयाच्या लोकांसाठी आहे.
प्रश्न किंवा कल्पना? support@katkee.com · katkee.com/support
प्रायव्हसी पॉलिसी: katkee.com/privacy · अटी: katkee.com/terms
<!-- /field -->

## More languages (worldwide)

Play shows people the listing in their phone's language when there is one, and search matches
the words of that language. These six cover most of Android's largest markets outside India.
The app itself is in all nine languages, and each description says so.

### Spanish, Latin America (es-419)
<!-- field:title:es -->
Katkee: Historias y chat
<!-- /field -->
<!-- field:short:es -->
Historias para tus mejores amigos. Música, chat, notas de voz y videollamadas.
<!-- /field -->
<!-- field:full:es -->
Katkee es una app de Historias para tus amigos de verdad. Comparte Historias de fotos y videos que duran 24 horas, como un estado, con música, texto y stickers animados, y elige quién ve cada una. Luego chatea, envía notas de voz y haz videollamadas. Publica para tu gente, no para desconocidos.

Por qué Katkee
• Mejores amigos: algunas Historias solo para tu círculo
• Tú eliges quién ve cada Historia: todos, seguidores o Mejores amigos
• Gratis, sin rastreo publicitario, y nunca vendemos tus datos

Crea Historias a tu estilo
• Estilos de texto, stickers animados, emojis, dibujo y filtros en toda la imagen
• Añade música y elige la mejor parte
• Layouts: un collage de hasta seis fotos
• Encuestas, cuestionarios, preguntas, cuentas regresivas y enlaces

Destacadas que duran
• Guarda tus mejores Historias en tu perfil para siempre
• Tus amigos pueden dar me gusta, comentar y compartir tus Destacadas

Chat y videollamadas
• Mensajes privados y grupos de hasta 32 amigos
• Notas de voz, fotos y videos
• Llamadas de voz y videollamadas
• Da me gusta a comentarios, respóndelos y etiqueta a amigos con @

Cerca de tus amigos
• Sigue a tus amigos con un toque

Seguro y privado
• Cuenta privada, inicio de sesión en dos pasos
• Bloquea, silencia y denuncia a quien quieras
• Descarga tus datos o elimina tu cuenta cuando quieras

Disponible en 9 idiomas. Katkee es para mayores de 18 años.
¿Preguntas? support@katkee.com · katkee.com/support
Privacidad: katkee.com/privacy · Términos: katkee.com/terms
<!-- /field -->

### Portuguese, Brazil (pt-BR)
<!-- field:title:pt -->
Katkee: Stories e chat
<!-- /field -->
<!-- field:short:pt -->
Stories para seus melhores amigos. Música, chat, áudios e videochamadas.
<!-- /field -->
<!-- field:full:pt -->
O Katkee é um app de Stories para seus amigos de verdade. Compartilhe Stories de fotos e vídeos que ficam 24 horas, como um status, com música, texto e figurinhas animadas, e escolha quem vê cada um. Depois converse, mande áudios e faça videochamadas. Publique para a sua turma, não para desconhecidos.

Por que o Katkee
• Melhores amigos: alguns Stories só para o seu círculo
• Você escolhe quem vê cada Story: todos, seguidores ou Melhores amigos
• Grátis, sem rastreamento de anúncios, e nunca vendemos seus dados

Crie Stories do seu jeito
• Estilos de texto, figurinhas animadas, emojis, desenho e filtros na imagem inteira
• Adicione música e escolha a melhor parte
• Layouts: uma colagem de até seis fotos
• Enquetes, quizzes, perguntas, contagens regressivas e links

Destaques que ficam
• Guarde seus melhores Stories no perfil para sempre
• Amigos podem curtir, comentar e compartilhar seus Destaques

Chat e videochamadas
• Mensagens privadas e grupos com até 32 amigos
• Áudios, fotos e vídeos
• Chamadas de voz e de vídeo
• Curta comentários, responda e marque amigos com @

Perto dos seus amigos
• Siga seus amigos com um toque

Seguro e privado
• Conta privada, login em duas etapas
• Bloqueie, silencie e denuncie quem quiser
• Baixe seus dados ou exclua sua conta quando quiser

Disponível em 9 idiomas. O Katkee é para maiores de 18 anos.
Dúvidas? support@katkee.com · katkee.com/support
Privacidade: katkee.com/privacy · Termos: katkee.com/terms
<!-- /field -->

### Indonesian (id)
<!-- field:title:id -->
Katkee: Story & Chat
<!-- /field -->
<!-- field:short:id -->
Story untuk teman dekatmu. Musik, chat, pesan suara dan video call.
<!-- /field -->
<!-- field:full:id -->
Katkee adalah aplikasi Story untuk teman-teman sejatimu. Bagikan Story foto dan video yang tampil 24 jam, seperti status, dengan musik, teks dan stiker animasi, dan pilih siapa yang melihat masing-masing. Lalu chat, kirim pesan suara dan video call. Posting untuk orang-orangmu, bukan untuk orang asing.

Kenapa Katkee
• Teman Dekat: sebagian Story hanya untuk lingkaran terdekat
• Kamu pilih siapa melihat setiap Story: semua, pengikut atau Teman Dekat
• Gratis, tanpa pelacakan iklan, dan kami tidak pernah menjual datamu

Buat Story dengan gayamu
• Gaya teks, stiker animasi, emoji, gambar dan filter untuk seluruh gambar
• Tambahkan musik dan pilih bagian terbaiknya
• Layout: kolase hingga enam foto
• Polling, kuis, pertanyaan, hitung mundur dan tautan

Sorotan yang bertahan
• Simpan Story terbaikmu di profil selamanya
• Teman bisa menyukai, mengomentari dan membagikan Sorotanmu

Chat dan video call
• Pesan pribadi dan grup hingga 32 teman
• Pesan suara, foto dan video
• Panggilan suara dan video call
• Sukai komentar, balas, dan tandai teman dengan @

Tetap dekat dengan temanmu
• Ikuti temanmu dengan sekali ketuk

Aman dan privat
• Akun privat, login dua langkah
• Blokir, bisukan dan laporkan siapa pun
• Unduh datamu atau hapus akunmu kapan saja

Tersedia dalam 9 bahasa. Katkee untuk usia 18 tahun ke atas.
Pertanyaan? support@katkee.com · katkee.com/support
Privasi: katkee.com/privacy · Ketentuan: katkee.com/terms
<!-- /field -->

### French (fr-FR)
<!-- field:title:fr -->
Katkee : Stories et chat
<!-- /field -->
<!-- field:short:fr -->
Des Stories pour vos amis proches. Musique, chat, vocaux et appels vidéo.
<!-- /field -->
<!-- field:full:fr -->
Katkee est une app de Stories pour vos vrais amis. Partagez des Stories photo et vidéo visibles 24 heures, comme un statut, avec musique, texte et stickers animés, et choisissez qui voit chacune. Puis discutez, envoyez des messages vocaux et passez des appels vidéo. Publiez pour vos proches, pas pour des inconnus.

Pourquoi Katkee
• Amis proches : certaines Stories pour votre cercle seulement
• Vous choisissez qui voit chaque Story : tout le monde, abonnés ou Amis proches
• Gratuit, sans pistage publicitaire, et nous ne vendons jamais vos données

Des Stories à votre image
• Styles de texte, stickers animés, emoji, dessin et filtres sur toute l'image
• Ajoutez de la musique et choisissez le meilleur passage
• Mises en page : un collage jusqu'à six photos
• Sondages, quiz, questions, comptes à rebours et liens

Des Stories à la une qui durent
• Gardez vos meilleures Stories sur votre profil pour toujours
• Vos amis peuvent les aimer, les commenter et les partager

Chat et appels vidéo
• Messages privés et groupes jusqu'à 32 amis
• Messages vocaux, photos et vidéos
• Appels vocaux et vidéo
• Aimez les commentaires, répondez-y et identifiez vos amis avec @

Proche de vos amis
• Suivez vos amis en un geste

Sûr et privé
• Compte privé, connexion en deux étapes
• Bloquez, masquez et signalez qui vous voulez
• Téléchargez vos données ou supprimez votre compte quand vous voulez

Disponible en 9 langues. Katkee est réservé aux 18 ans et plus.
Des questions ? support@katkee.com · katkee.com/support
Confidentialité : katkee.com/privacy · Conditions : katkee.com/terms
<!-- /field -->

### German (de-DE)
<!-- field:title:de -->
Katkee: Stories & Chat
<!-- /field -->
<!-- field:short:de -->
Stories für deine engen Freunde. Musik, Chat, Sprachnachrichten, Videoanrufe.
<!-- /field -->
<!-- field:full:de -->
Katkee ist eine Stories-App für deine echten Freunde. Teile Foto- und Video-Stories, die 24 Stunden sichtbar bleiben, wie ein Status, mit Musik, Text und animierten Stickern, und bestimme, wer welche sieht. Dann chatte, schick Sprachnachrichten und telefoniere per Video. Poste für deine Leute, nicht für Fremde.

Warum Katkee
• Enge Freunde: manche Stories nur für deinen engsten Kreis
• Du bestimmst, wer jede Story sieht: alle, Follower oder Enge Freunde
• Kostenlos, ohne Werbe-Tracking, und wir verkaufen deine Daten nie

Stories in deinem Stil
• Textstile, animierte Sticker, Emojis, Zeichnen und Filter fürs ganze Bild
• Musik hinzufügen und die beste Stelle wählen
• Layouts: eine Collage aus bis zu sechs Fotos
• Umfragen, Quiz, Fragen, Countdowns und Links

Highlights, die bleiben
• Behalte deine besten Stories für immer im Profil
• Freunde können deine Highlights liken, kommentieren und teilen

Chat und Videoanrufe
• Private Nachrichten und Gruppen mit bis zu 32 Freunden
• Sprachnachrichten, Fotos und Videos
• Sprach- und Videoanrufe
• Kommentare liken, beantworten und Freunde mit @ markieren

Nah bei deinen Freunden
• Folge deinen Freunden mit einem Tipp

Sicher und privat
• Privates Konto, Anmeldung in zwei Schritten
• Blockiere, stummschalte und melde jeden
• Lade deine Daten herunter oder lösche dein Konto, wann du willst

In 9 Sprachen verfügbar. Katkee ist für Menschen ab 18 Jahren.
Fragen? support@katkee.com · katkee.com/support
Datenschutz: katkee.com/privacy · Bedingungen: katkee.com/terms
<!-- /field -->

### Arabic (ar)
<!-- field:title:ar -->
Katkee: قصص ودردشة
<!-- /field -->
<!-- field:short:ar -->
قصص لأصدقائك المقربين. موسيقى ودردشة ورسائل صوتية ومكالمات فيديو.
<!-- /field -->
<!-- field:full:ar -->
Katkee تطبيق قصص لأصدقائك الحقيقيين. شارك قصص الصور والفيديو التي تبقى 24 ساعة، مثل الحالة، مع الموسيقى والنص والملصقات المتحركة، واختر من يرى كل قصة. ثم دردش وأرسل رسائل صوتية واتصل بالفيديو. انشر لناسك، لا للغرباء.

لماذا Katkee
• الأصدقاء المقربون: بعض القصص لدائرتك القريبة فقط
• أنت تختار من يرى كل قصة: الجميع أو المتابعون أو الأصدقاء المقربون
• مجاني، بلا تتبع إعلاني، ولا نبيع بياناتك أبدًا

اصنع قصصًا بأسلوبك
• أنماط نص وملصقات متحركة ورموز تعبيرية ورسم وفلاتر تغطي الصورة كلها
• أضف موسيقى واختر أفضل جزء منها
• التخطيطات: مجموعة حتى ست صور
• استطلاعات واختبارات وأسئلة وعدّ تنازلي وروابط

قصص مميزة تبقى
• احتفظ بأفضل قصصك على ملفك الشخصي للأبد
• يمكن لأصدقائك الإعجاب بها والتعليق عليها ومشاركتها

الدردشة ومكالمات الفيديو
• رسائل خاصة ومجموعات حتى 32 صديقًا
• رسائل صوتية وصور وفيديو
• مكالمات صوتية ومكالمات فيديو
• أعجب بالتعليقات ورُدّ عليها وأشر إلى أصدقائك بـ @

قريب من أصدقائك
• تابع أصدقاءك بلمسة واحدة

آمن وخاص
• حساب خاص وتسجيل دخول بخطوتين
• احظر أو اكتم أو أبلغ عن أي شخص
• نزّل بياناتك أو احذف حسابك متى شئت

متوفر بـ 9 لغات. Katkee لمن هم في الثامنة عشرة فما فوق.
أسئلة؟ support@katkee.com · katkee.com/support
الخصوصية: katkee.com/privacy · الشروط: katkee.com/terms
<!-- /field -->

## Graphics (ready to upload)

| Asset | Size | File |
| --- | --- | --- |
| App icon | 512 x 512 PNG | `brand/store/google-play-icon-512.png` |
| Feature graphic | 1024 x 500 PNG | `brand/store/google-play-feature-graphic-1024x500.png` |
| Phone screenshots (8) | 1080 x 1920 PNG | `brand/store/screenshots/phone/01-home.png` … `08-activity.png` (01 Stories, 02 music and stickers, 03 who sees it, 04 chat and calls, 05 Highlights, 06 Layout, 07 groups, 08 Activity) (English and the six other languages); `phone-hi/`, `phone-mr/` for Hindi and Marathi |
| 7-inch and 10-inch tablet screenshots (8) | 1920 x 1080 PNG | `brand/store/screenshots/tablet/…`; `tablet-hi/`, `tablet-mr/` |

Upload them in their numbered order: Play shows the first three without scrolling. They are the
real app (Android emulator, flow=store on the emulator workflow, with demo accounts and photos;
see `brand/store/photos/SOURCES.md`), framed by `brand/store/screenshots/make.cjs`; the feature
graphic by `brand/store/make-feature-graphic.cjs`. To make them again after a design change:
run the workflow with flow=store, copy the screens into `brand/store/screenshots/raw/`, then
run both scripts.

## Listing rules kept (Google's metadata policy)

No competitors' names, no "best", "#1" or "free download", no ratings or awards claims, no
headings in capitals, no emoji in the text, no keyword lists, and every feature named is in
the app. Breaking these gets a listing demoted or rejected.
