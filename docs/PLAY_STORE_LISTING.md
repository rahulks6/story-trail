# Google Play store listing (ASO)

The text to paste into Play Console (Grow users > Store presence > Main store listing), written for
search: the words people type when they look for an app like Katkee ("stories", "share stories",
"chat", "video call", "friends", "private") sit in the title, the short description and the first
lines of the full description, where Play weighs them most, and are repeated naturally (never
stuffed: Google demotes keyword lists). Everything described is in the app from release 84 (the
Postcard design: Today, polaroid Stories, Memories), so publish this text with release 84.
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
| status | In India people search "status" for 24-hour photo and video posts; a generic word, used plainly | Title, full ("like a status") |
| story maker, photo collage, add music to story | Creation searches with clear intent | Full |
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

1. **First screenshot**: Today (a polaroid Story) against the editor (street photo with
   "Golden hour"). The first screenshot decides most installs.
2. **Short description**: the current one against "Share your day in Stories. Chat, send voice notes and
   video call your friends."
3. **App name**: "Katkee: Stories, Status & Chat" against "Katkee: Stories, Chat & Calls".
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
Katkee: Stories, Status & Chat
<!-- /field -->

### Short description (80 characters max)
<!-- field:short:en -->
Your day as postcard Stories with music. Chat and video call your friends.
<!-- /field -->

### Full description (4,000 characters max)
<!-- field:full:en -->
Katkee turns your day into Stories that feel like postcards. Share photo and video Stories that stay up for 24 hours, like a status, with music, text and animated stickers. Then chat, send voice notes and video call your friends. No endless feed of strangers, no copying anyone's look: just your people, your day.

Why people choose Katkee
• Today: your friends' Stories, one postcard at a time. Swipe up for the next
• Nothing cropped: every Story shows whole, in a polaroid frame, with its caption handwritten underneath
• Private by design: you choose who sees every Story
• Free to use, with no ad tracking, and we never sell your data

Make Stories that look like you
• Post photo and video Stories that last 24 hours, like a status update
• Story maker tools: text styles, animated stickers, emoji, drawing and filters
• Filters cover the whole photo or video, edge to edge
• Add music to your Story from Katkee's song library
• Layouts: a photo collage of up to six photos in one Story
• Polls, quizzes, questions, countdowns and links make Stories interactive
• Close Friends: share some Stories only with your inner circle
• Festival Stories: Katkee spots the festival in your Story and adds it for you

Keep your best days as Memories
• Save your favourite Stories to Memories on your profile, forever
• Friends can like, comment on and share your Memories

Chat and video call
• Private messages and group chats with up to 32 friends
• Voice notes, photos and videos in every chat
• Voice calls and video calls with friends
• Reply to a Story, react with an emoji, or double tap to like
• See when your messages are sent, delivered and seen

Discover Stories you'll love
• Katkee understands what each Story is about, so no hashtags needed
• Explore popular Stories and find new people to follow
• Follow anyone in one tap from their profile or their Story

Safe and private social app
• Private account: approve who follows you
• Choose who sees each Story: everyone, followers or Close Friends
• Two-step login protects your account
• Block, mute and report anyone, any time
• Download a copy of your data, or delete your account whenever you like

Made for everyone
• In English, Hindi, Marathi, Spanish, Portuguese, Indonesian, French, German and Arabic
• A warm light look, or dark mode if you prefer
• Several accounts on one phone, switch in one tap
• Picture descriptions for people who use a screen reader

Katkee is for people aged 18 and over.
Questions or ideas? support@katkee.com · katkee.com/support
Privacy Policy: katkee.com/privacy · Terms: katkee.com/terms
<!-- /field -->

## Hindi (hi-IN)

### App name
<!-- field:title:hi -->
Katkee: स्टोरीज़, चैट और कॉल
<!-- /field -->

### Short description
<!-- field:short:hi -->
अपना दिन पोस्टकार्ड जैसी स्टोरीज़ में। दोस्तों से चैट और वीडियो कॉल करें।
<!-- /field -->

### Full description
<!-- field:full:hi -->
Katkee आपके दिन को पोस्टकार्ड जैसी स्टोरीज़ में बदल देता है। फ़ोटो और वीडियो स्टोरीज़ शेयर करें जो स्टेटस की तरह 24 घंटे रहती हैं, म्यूज़िक, टेक्स्ट और एनिमेटेड स्टिकर के साथ। फिर दोस्तों से चैट करें, वॉइस नोट भेजें और वीडियो कॉल करें। अनजान लोगों की अंतहीन फ़ीड नहीं: बस आपके अपने लोग, आपका दिन।

लोग Katkee क्यों चुनते हैं
• आज (Today): दोस्तों की स्टोरीज़, एक बार में एक पोस्टकार्ड। अगली के लिए ऊपर स्वाइप करें
• कुछ भी कटता नहीं: हर स्टोरी पूरी दिखती है, पोलेरॉइड फ़्रेम में, नीचे हाथ से लिखा कैप्शन
• प्राइवेसी पहले: हर स्टोरी कौन देखे, आप तय करते हैं
• मुफ़्त, कोई ऐड ट्रैकिंग नहीं, और हम आपका डेटा कभी नहीं बेचते

अपने अंदाज़ की स्टोरीज़ बनाएँ
• फ़ोटो और वीडियो स्टोरीज़ जो स्टेटस की तरह 24 घंटे रहती हैं
• टेक्स्ट स्टाइल, एनिमेटेड स्टिकर, इमोजी, ड्रॉइंग और फ़िल्टर
• फ़िल्टर पूरी फ़ोटो या वीडियो पर, किनारे से किनारे तक
• Katkee की म्यूज़िक लाइब्रेरी से स्टोरी में गाना जोड़ें
• लेआउट: एक स्टोरी में छह फ़ोटो तक का कोलाज
• पोल, क्विज़, सवाल, काउंटडाउन और लिंक
• क्लोज़ फ़्रेंड्स: कुछ स्टोरीज़ सिर्फ़ ख़ास लोगों के लिए
• त्योहार स्टोरीज़: Katkee आपकी स्टोरी में त्योहार पहचानकर ख़ुद जोड़ देता है

ख़ास दिन यादों (Memories) में
• पसंदीदा स्टोरीज़ अपनी प्रोफ़ाइल पर यादों में हमेशा के लिए रखें
• दोस्त आपकी यादों को लाइक, कमेंट और शेयर कर सकते हैं

चैट और वीडियो कॉल
• प्राइवेट मैसेज और 32 दोस्तों तक के ग्रुप चैट
• हर चैट में वॉइस नोट, फ़ोटो और वीडियो
• दोस्तों से वॉइस कॉल और वीडियो कॉल
• स्टोरी का जवाब दें, इमोजी से रिएक्ट करें या डबल टैप से लाइक करें
• देखें मैसेज कब भेजा गया, पहुँचा और देखा गया

पसंद की स्टोरीज़ खोजें
• Katkee समझता है कि हर स्टोरी किस बारे में है, हैशटैग की ज़रूरत नहीं
• लोकप्रिय स्टोरीज़ देखें और नए लोगों को फ़ॉलो करें
• किसी की प्रोफ़ाइल या स्टोरी से एक टैप में फ़ॉलो करें

सुरक्षित और प्राइवेट
• प्राइवेट अकाउंट: तय करें कौन आपको फ़ॉलो करे
• हर स्टोरी के लिए चुनें: सब, फ़ॉलोअर या क्लोज़ फ़्रेंड्स
• टू-स्टेप लॉगिन से अकाउंट सुरक्षित
• किसी को भी ब्लॉक, म्यूट या रिपोर्ट करें
• अपने डेटा की कॉपी डाउनलोड करें, या जब चाहें अकाउंट डिलीट करें

सबके लिए
• हिंदी, मराठी, अंग्रेज़ी और छह और भाषाओं में
• हल्का गर्म लुक, या पसंद हो तो डार्क मोड
• एक फ़ोन पर कई अकाउंट, एक टैप में बदलें
• स्क्रीन रीडर इस्तेमाल करने वालों के लिए तस्वीरों का विवरण

Katkee 18 साल और उससे ज़्यादा उम्र के लोगों के लिए है।
सवाल या सुझाव? support@katkee.com · katkee.com/support
प्राइवेसी पॉलिसी: katkee.com/privacy · शर्तें: katkee.com/terms
<!-- /field -->

## Marathi (mr-IN)

### App name
<!-- field:title:mr -->
Katkee: स्टोरीज, चॅट आणि कॉल
<!-- /field -->

### Short description
<!-- field:short:mr -->
तुमचा दिवस पोस्टकार्डसारख्या स्टोरीजमध्ये. मित्रांशी चॅट आणि व्हिडिओ कॉल करा.
<!-- /field -->

### Full description
<!-- field:full:mr -->
Katkee तुमचा दिवस पोस्टकार्डसारख्या स्टोरीजमध्ये बदलतो. स्टेटससारख्या 24 तास राहणाऱ्या फोटो आणि व्हिडिओ स्टोरीज शेअर करा, संगीत, टेक्स्ट आणि ॲनिमेटेड स्टिकरसोबत. मग मित्रांशी चॅट करा, व्हॉइस नोट पाठवा आणि व्हिडिओ कॉल करा. अनोळखी लोकांची न संपणारी फीड नाही: फक्त तुमची माणसं, तुमचा दिवस.

लोक Katkee का निवडतात
• आज (Today): मित्रांच्या स्टोरीज, एका वेळी एक पोस्टकार्ड. पुढच्यासाठी वर स्वाइप करा
• काहीही कापलं जात नाही: प्रत्येक स्टोरी पूर्ण दिसते, पोलरॉइड फ्रेममध्ये, खाली हाताने लिहिलेलं कॅप्शन
• प्रायव्हसी आधी: प्रत्येक स्टोरी कोण पाहील, हे तुम्ही ठरवता
• मोफत, कोणतंही ॲड ट्रॅकिंग नाही, आणि आम्ही तुमचा डेटा कधीच विकत नाही

तुमच्या पद्धतीच्या स्टोरीज बनवा
• स्टेटससारख्या 24 तास राहणाऱ्या फोटो आणि व्हिडिओ स्टोरीज
• टेक्स्ट स्टाइल, ॲनिमेटेड स्टिकर, इमोजी, ड्रॉइंग आणि फिल्टर
• फिल्टर संपूर्ण फोटो किंवा व्हिडिओवर, कडेपासून कडेपर्यंत
• Katkee च्या संगीत लायब्ररीतून स्टोरीत गाणं जोडा
• लेआउट: एका स्टोरीत सहा फोटोपर्यंतचा कोलाज
• पोल, क्विझ, प्रश्न, काउंटडाउन आणि लिंक
• क्लोज फ्रेंड्स: काही स्टोरीज फक्त खास लोकांसाठी
• सणांच्या स्टोरीज: Katkee तुमच्या स्टोरीतला सण ओळखून आपोआप जोडतो

खास दिवस आठवणींमध्ये (Memories)
• आवडत्या स्टोरीज तुमच्या प्रोफाइलवर आठवणींमध्ये कायमच्या ठेवा
• मित्र तुमच्या आठवणी लाइक, कमेंट आणि शेअर करू शकतात

चॅट आणि व्हिडिओ कॉल
• प्रायव्हेट मेसेज आणि 32 मित्रांपर्यंतचे ग्रुप चॅट
• प्रत्येक चॅटमध्ये व्हॉइस नोट, फोटो आणि व्हिडिओ
• मित्रांशी व्हॉइस कॉल आणि व्हिडिओ कॉल
• स्टोरीला उत्तर द्या, इमोजीने रिॲक्ट करा किंवा डबल टॅपने लाइक करा
• मेसेज कधी पाठवला, पोहोचला आणि पाहिला ते पाहा

आवडतील अशा स्टोरीज शोधा
• Katkee ला प्रत्येक स्टोरी कशाबद्दल आहे ते समजतं, हॅशटॅगची गरज नाही
• लोकप्रिय स्टोरीज पाहा आणि नवीन लोकांना फॉलो करा
• कोणाच्याही प्रोफाइलवरून किंवा स्टोरीतून एका टॅपमध्ये फॉलो करा

सुरक्षित आणि प्रायव्हेट
• प्रायव्हेट अकाउंट: तुम्हाला कोण फॉलो करेल ते ठरवा
• प्रत्येक स्टोरीसाठी निवडा: सगळे, फॉलोअर किंवा क्लोज फ्रेंड्स
• टू-स्टेप लॉगिनने अकाउंट सुरक्षित
• कोणालाही ब्लॉक, म्यूट किंवा रिपोर्ट करा
• तुमच्या डेटाची कॉपी डाउनलोड करा, किंवा हवं तेव्हा अकाउंट डिलीट करा

सगळ्यांसाठी
• मराठी, हिंदी, इंग्रजी आणि आणखी सहा भाषांमध्ये
• उबदार हलका लुक, किंवा आवडत असल्यास डार्क मोड
• एका फोनवर अनेक अकाउंट, एका टॅपमध्ये बदला
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
Tu día en Historias como postales, con música. Chatea y videollama a tus amigos.
<!-- /field -->
<!-- field:full:es -->
Katkee convierte tu día en Historias que parecen postales. Comparte Historias de fotos y videos que duran 24 horas, como un estado, con música, texto y stickers animados. Luego chatea, envía notas de voz y haz videollamadas con tus amigos. Sin un feed infinito de desconocidos: solo tu gente, tu día.

Por qué Katkee
• Hoy: las Historias de tus amigos, una postal a la vez. Desliza hacia arriba para la siguiente
• Nada recortado: cada Historia se ve completa, en un marco de polaroid, con el texto escrito a mano debajo
• Privado por diseño: tú eliges quién ve cada Historia
• Gratis, sin rastreo publicitario, y nunca vendemos tus datos

Crea Historias a tu estilo
• Historias de fotos y videos que duran 24 horas
• Estilos de texto, stickers animados, emojis, dibujo y filtros que cubren toda la imagen
• Añade música de la biblioteca de Katkee
• Layouts: un collage de hasta seis fotos en una Historia
• Encuestas, cuestionarios, preguntas, cuentas regresivas y enlaces
• Mejores amigos: comparte algunas Historias solo con tu círculo cercano
• Historias de festividades: Katkee reconoce la festividad y la añade por ti

Guarda tus mejores días en Recuerdos
• Guarda tus Historias favoritas en Recuerdos, en tu perfil, para siempre
• Tus amigos pueden dar me gusta, comentar y compartir tus Recuerdos

Chat y videollamadas
• Mensajes privados y grupos de hasta 32 amigos
• Notas de voz, fotos y videos en cada chat
• Llamadas de voz y videollamadas
• Responde a una Historia o reacciona con un emoji

Seguro y privado
• Cuenta privada: aprueba quién te sigue
• Elige quién ve cada Historia: todos, seguidores o Mejores amigos
• Inicio de sesión en dos pasos
• Bloquea, silencia y denuncia a quien quieras
• Descarga tus datos o elimina tu cuenta cuando quieras

En 9 idiomas, con un aspecto claro y cálido o modo oscuro, y varias cuentas en un teléfono.

Katkee es para mayores de 18 años.
¿Preguntas? support@katkee.com · katkee.com/support
Privacidad: katkee.com/privacy · Términos: katkee.com/terms
<!-- /field -->

### Portuguese, Brazil (pt-BR)
<!-- field:title:pt -->
Katkee: Stories e chat
<!-- /field -->
<!-- field:short:pt -->
Seu dia em Stories como cartões-postais, com música. Chat e videochamadas.
<!-- /field -->
<!-- field:full:pt -->
O Katkee transforma seu dia em Stories que parecem cartões-postais. Compartilhe Stories de fotos e vídeos que ficam 24 horas no ar, como um status, com música, texto e figurinhas animadas. Depois converse, mande áudios e faça videochamadas com seus amigos. Sem um feed infinito de desconhecidos: só a sua turma, o seu dia.

Por que o Katkee
• Hoje: os Stories dos seus amigos, um cartão-postal por vez. Deslize para cima para o próximo
• Nada cortado: cada Story aparece inteiro, numa moldura de polaroid, com a legenda escrita à mão embaixo
• Privacidade em primeiro lugar: você escolhe quem vê cada Story
• Grátis, sem rastreamento de anúncios, e nunca vendemos seus dados

Crie Stories do seu jeito
• Stories de fotos e vídeos que duram 24 horas
• Estilos de texto, figurinhas animadas, emojis, desenho e filtros na imagem inteira
• Adicione música da biblioteca do Katkee
• Layouts: uma colagem de até seis fotos em um Story
• Enquetes, quizzes, perguntas, contagens regressivas e links
• Melhores amigos: alguns Stories só para o seu círculo
• Stories de datas especiais: o Katkee reconhece a festa e adiciona para você

Guarde seus melhores dias em Memórias
• Salve seus Stories favoritos em Memórias, no seu perfil, para sempre
• Amigos podem curtir, comentar e compartilhar suas Memórias

Chat e videochamadas
• Mensagens privadas e grupos com até 32 amigos
• Áudios, fotos e vídeos em cada conversa
• Chamadas de voz e de vídeo
• Responda a um Story ou reaja com um emoji

Seguro e privado
• Conta privada: aprove quem segue você
• Escolha quem vê cada Story: todos, seguidores ou Melhores amigos
• Login em duas etapas
• Bloqueie, silencie e denuncie quem quiser
• Baixe seus dados ou exclua sua conta quando quiser

Em 9 idiomas, com um visual claro e acolhedor ou modo escuro, e várias contas em um celular.

O Katkee é para maiores de 18 anos.
Dúvidas? support@katkee.com · katkee.com/support
Privacidade: katkee.com/privacy · Termos: katkee.com/terms
<!-- /field -->

### Indonesian (id)
<!-- field:title:id -->
Katkee: Story & Chat
<!-- /field -->
<!-- field:short:id -->
Harimu jadi Story ala kartu pos, dengan musik. Chat dan video call temanmu.
<!-- /field -->
<!-- field:full:id -->
Katkee mengubah harimu menjadi Story yang terasa seperti kartu pos. Bagikan Story foto dan video yang tampil 24 jam, seperti status, dengan musik, teks, dan stiker animasi. Lalu chat, kirim pesan suara, dan video call teman-temanmu. Tanpa feed orang asing yang tak ada habisnya: hanya orang-orangmu, harimu.

Kenapa Katkee
• Hari Ini: Story teman-temanmu, satu kartu pos setiap kali. Geser ke atas untuk berikutnya
• Tidak ada yang terpotong: setiap Story tampil utuh dalam bingkai polaroid, dengan keterangan tulisan tangan di bawahnya
• Privat sejak awal: kamu yang memilih siapa melihat setiap Story
• Gratis, tanpa pelacakan iklan, dan kami tidak pernah menjual datamu

Buat Story dengan gayamu
• Story foto dan video yang bertahan 24 jam
• Gaya teks, stiker animasi, emoji, gambar, dan filter untuk seluruh gambar
• Tambahkan musik dari pustaka lagu Katkee
• Layout: kolase hingga enam foto dalam satu Story
• Polling, kuis, pertanyaan, hitung mundur, dan tautan
• Teman Dekat: bagikan sebagian Story hanya untuk lingkaran terdekat
• Story hari raya: Katkee mengenali hari rayanya dan menambahkannya untukmu

Simpan hari terbaikmu di Kenangan
• Simpan Story favorit di Kenangan, di profilmu, selamanya
• Teman bisa menyukai, mengomentari, dan membagikan Kenanganmu

Chat dan video call
• Pesan pribadi dan grup hingga 32 teman
• Pesan suara, foto, dan video di setiap chat
• Panggilan suara dan video call
• Balas Story atau beri reaksi emoji

Aman dan privat
• Akun privat: setujui siapa yang mengikutimu
• Pilih siapa melihat setiap Story: semua, pengikut, atau Teman Dekat
• Login dua langkah
• Blokir, bisukan, dan laporkan siapa pun
• Unduh datamu atau hapus akunmu kapan saja

Dalam 9 bahasa, dengan tampilan terang yang hangat atau mode gelap, dan beberapa akun di satu ponsel.

Katkee untuk usia 18 tahun ke atas.
Pertanyaan? support@katkee.com · katkee.com/support
Privasi: katkee.com/privacy · Ketentuan: katkee.com/terms
<!-- /field -->

### French (fr-FR)
<!-- field:title:fr -->
Katkee : Stories et chat
<!-- /field -->
<!-- field:short:fr -->
Votre journée en Stories façon cartes postales. Chat et appels vidéo entre amis.
<!-- /field -->
<!-- field:full:fr -->
Katkee transforme votre journée en Stories qui ressemblent à des cartes postales. Partagez des Stories photo et vidéo visibles 24 heures, comme un statut, avec musique, texte et stickers animés. Puis discutez, envoyez des messages vocaux et passez des appels vidéo à vos amis. Pas de fil infini d'inconnus : juste vos proches, votre journée.

Pourquoi Katkee
• Aujourd'hui : les Stories de vos amis, une carte postale à la fois. Glissez vers le haut pour la suivante
• Rien n'est coupé : chaque Story s'affiche en entier, dans un cadre polaroid, avec sa légende manuscrite dessous
• Privé par conception : vous choisissez qui voit chaque Story
• Gratuit, sans pistage publicitaire, et nous ne vendons jamais vos données

Des Stories à votre image
• Stories photo et vidéo visibles 24 heures
• Styles de texte, stickers animés, emoji, dessin et filtres sur toute l'image
• Ajoutez de la musique depuis la bibliothèque de Katkee
• Mises en page : un collage jusqu'à six photos dans une Story
• Sondages, quiz, questions, comptes à rebours et liens
• Amis proches : certaines Stories pour votre cercle seulement
• Stories de fête : Katkee reconnaît la fête et l'ajoute pour vous

Gardez vos plus beaux jours en Souvenirs
• Enregistrez vos Stories préférées dans Souvenirs, sur votre profil, pour toujours
• Vos amis peuvent aimer, commenter et partager vos Souvenirs

Chat et appels vidéo
• Messages privés et groupes jusqu'à 32 amis
• Messages vocaux, photos et vidéos dans chaque discussion
• Appels vocaux et vidéo
• Répondez à une Story ou réagissez avec un emoji

Sûr et privé
• Compte privé : approuvez qui vous suit
• Choisissez qui voit chaque Story : tout le monde, abonnés ou Amis proches
• Connexion en deux étapes
• Bloquez, masquez et signalez qui vous voulez
• Téléchargez vos données ou supprimez votre compte quand vous voulez

En 9 langues, avec un thème clair et chaleureux ou un mode sombre, et plusieurs comptes sur un téléphone.

Katkee est réservé aux 18 ans et plus.
Des questions ? support@katkee.com · katkee.com/support
Confidentialité : katkee.com/privacy · Conditions : katkee.com/terms
<!-- /field -->

### German (de-DE)
<!-- field:title:de -->
Katkee: Stories & Chat
<!-- /field -->
<!-- field:short:de -->
Dein Tag in Stories wie Postkarten, mit Musik. Chatte und videotelefoniere.
<!-- /field -->
<!-- field:full:de -->
Katkee macht aus deinem Tag Stories, die sich wie Postkarten anfühlen. Teile Foto- und Video-Stories, die 24 Stunden sichtbar bleiben, wie ein Status, mit Musik, Text und animierten Stickern. Dann chatte, schick Sprachnachrichten und telefoniere per Video mit deinen Freunden. Kein endloser Feed von Fremden: nur deine Leute, dein Tag.

Warum Katkee
• Heute: die Stories deiner Freunde, eine Postkarte nach der anderen. Wisch nach oben für die nächste
• Nichts wird abgeschnitten: jede Story ganz, im Polaroid-Rahmen, mit handgeschriebener Bildunterschrift
• Privat von Anfang an: du bestimmst, wer jede Story sieht
• Kostenlos, ohne Werbe-Tracking, und wir verkaufen deine Daten nie

Stories in deinem Stil
• Foto- und Video-Stories, die 24 Stunden bleiben
• Textstile, animierte Sticker, Emojis, Zeichnen und Filter fürs ganze Bild
• Musik aus der Katkee-Bibliothek hinzufügen
• Layouts: eine Collage aus bis zu sechs Fotos in einer Story
• Umfragen, Quiz, Fragen, Countdowns und Links
• Enge Freunde: manche Stories nur für deinen engsten Kreis
• Feiertags-Stories: Katkee erkennt den Feiertag und fügt ihn für dich hinzu

Deine besten Tage als Erinnerungen
• Speichere Lieblings-Stories für immer als Erinnerungen in deinem Profil
• Freunde können deine Erinnerungen liken, kommentieren und teilen

Chat und Videoanrufe
• Private Nachrichten und Gruppen mit bis zu 32 Freunden
• Sprachnachrichten, Fotos und Videos in jedem Chat
• Sprach- und Videoanrufe
• Auf eine Story antworten oder mit einem Emoji reagieren

Sicher und privat
• Privates Konto: bestätige, wer dir folgt
• Wähle für jede Story: alle, Follower oder Enge Freunde
• Anmeldung in zwei Schritten
• Blockiere, stummschalte und melde jeden
• Lade deine Daten herunter oder lösche dein Konto, wann du willst

In 9 Sprachen, mit warmem hellem Design oder Dunkelmodus, und mehreren Konten auf einem Handy.

Katkee ist für Menschen ab 18 Jahren.
Fragen? support@katkee.com · katkee.com/support
Datenschutz: katkee.com/privacy · Bedingungen: katkee.com/terms
<!-- /field -->

### Arabic (ar)
<!-- field:title:ar -->
Katkee: قصص ودردشة
<!-- /field -->
<!-- field:short:ar -->
يومك في قصص كأنها بطاقات بريدية مع موسيقى. دردش واتصل بالفيديو مع أصدقائك.
<!-- /field -->
<!-- field:full:ar -->
يحوّل Katkee يومك إلى قصص تبدو كبطاقات بريدية. شارك قصص الصور والفيديو التي تبقى 24 ساعة، مثل الحالة، مع الموسيقى والنص والملصقات المتحركة. ثم دردش وأرسل رسائل صوتية واتصل بالفيديو مع أصدقائك. لا خلاصة لا نهائية من الغرباء: فقط ناسك، ويومك.

لماذا Katkee
• اليوم: قصص أصدقائك، بطاقة بريدية في كل مرة. اسحب للأعلى للقصة التالية
• لا شيء يُقص: تظهر كل قصة كاملة داخل إطار بولارويد، مع تعليق مكتوب بخط اليد أسفلها
• الخصوصية أولاً: أنت تختار من يرى كل قصة
• مجاني، بلا تتبع إعلاني، ولا نبيع بياناتك أبداً

اصنع قصصاً بأسلوبك
• قصص صور وفيديو تبقى 24 ساعة
• أنماط نص وملصقات متحركة ورموز تعبيرية ورسم وفلاتر تغطي الصورة كلها
• أضف موسيقى من مكتبة Katkee
• التخطيطات: مجموعة حتى ست صور في قصة واحدة
• استطلاعات واختبارات وأسئلة وعدّ تنازلي وروابط
• الأصدقاء المقربون: بعض القصص لدائرتك القريبة فقط
• قصص المناسبات: يتعرّف Katkee على المناسبة ويضيفها لك

احتفظ بأجمل أيامك في الذكريات
• احفظ قصصك المفضلة في الذكريات على ملفك الشخصي، للأبد
• يمكن لأصدقائك الإعجاب بذكرياتك والتعليق عليها ومشاركتها

الدردشة ومكالمات الفيديو
• رسائل خاصة ومجموعات حتى 32 صديقاً
• رسائل صوتية وصور وفيديو في كل دردشة
• مكالمات صوتية ومكالمات فيديو
• رُدّ على قصة أو تفاعل برمز تعبيري

آمن وخاص
• حساب خاص: وافق على من يتابعك
• اختر من يرى كل قصة: الجميع أو المتابعون أو الأصدقاء المقربون
• تسجيل دخول بخطوتين
• احظر أو اكتم أو أبلغ عن أي شخص
• نزّل بياناتك أو احذف حسابك متى شئت

بـ 9 لغات، بمظهر فاتح دافئ أو وضع داكن، وعدة حسابات على هاتف واحد.

Katkee لمن هم في الثامنة عشرة فما فوق.
أسئلة؟ support@katkee.com · katkee.com/support
الخصوصية: katkee.com/privacy · الشروط: katkee.com/terms
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

## Listing rules kept (Google's metadata policy)

No competitors' names, no "best", "#1" or "free download", no ratings or awards claims, no
headings in capitals, no emoji in the text, no keyword lists, and every feature named is in
the app. Breaking these gets a listing demoted or rejected.
