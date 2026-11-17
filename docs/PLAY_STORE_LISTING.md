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

## Keyword plan (researched November 2026)

Play reads the title (strongest), the short description (next) and the full description; there
is no keyword field. Play doesn't publish search volumes, and ASO tools only estimate them from
Play's search suggestions, so these priorities come from what ranks in India today: the "status"
category (video status, status with song, Hindi and festival status) is one of the most crowded
and most searched in India, and "close friends" is the space Katkee owns (the nearest rival,
Locket, sells a home-screen widget, not Stories with chat). Repeat a keyword naturally, about
once per 250 characters; never stuff.

| Priority | Keyword | Where it is |
| --- | --- | --- |
| 1 | stories, story | Title, short, full (12+ times) |
| 1 | status | Title, short, full ("status with music", "video status", "festival status") |
| 1 | close friends | Short, full (opening line and 4 more) |
| 1 | chat | Title, short, full |
| 2 | status with song / music, story with music | Short, full |
| 2 | video status, photo status, story maker | Full |
| 2 | voice notes, video call, group chat | Short, full |
| 3 | private, friends only, inner circle | Full |
| 3 | festival status (Diwali, Holi, Eid, Christmas) | Full; seasonal Custom store listings |
| 3 | share to WhatsApp | Full |
| Hindi | स्टोरी, स्टेटस, चैट, वीडियो कॉल, क्लोज़ फ़्रेंड्स | The hi listing (title has स्टेटस) |

After the listing has been live 2-3 weeks, Play Console → Grow users → Store performance →
Store analysis → Search terms shows the words that really bring visitors and installers: move
the best of them up (title or short description) and drop what brings nothing.

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

1. **First screenshot**: Home (palm beach Story) against the editor (street photo with
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
Close friends Stories & status with music. Chat, voice notes and video calls.
<!-- /field -->

### Full description (4,000 characters max)
<!-- field:full:en -->
Katkee is a Stories and status app for your close friends. Post your day as photo and video Stories that last 24 hours, like a status, add a song, text and animated stickers, and choose exactly who sees it: everyone, followers or only your Close Friends. Then chat, send voice notes and video call your friends, all in one app.

Why people choose Katkee
• Close Friends Stories: share some moments only with your inner circle
• You choose who sees every Story and status update
• Stories from your friends on Home, one swipe at a time
• Free, with no ad tracking, and we never sell your data

Status with music, made in seconds
• Photo status and video status that last 24 hours
• Add a song to your Story and pick the best part of it
• Story maker tools: text styles, animated stickers, emoji, drawing and filters that cover the whole photo or video
• Layouts: a photo collage of up to six photos in one Story
• Polls, quizzes, questions, countdowns and links
• Festival status: Katkee spots Diwali, Holi, Eid, Christmas and more in your Story and adds it to the festival ring

Highlights that last
• Keep your best Stories on your profile as Highlights, forever
• Friends can like, comment on and share your Highlights
• Explore other people's Highlights after you've seen every new Story

Chat, voice notes and video calls
• Private chats and group chats with up to 32 friends
• Voice notes, photos and videos in every chat
• Voice calls and video calls
• Reply to a Story, react with an emoji or double tap to like
• Share your Story to WhatsApp in one tap

Meet your people
• Crossed paths (optional, off until you turn it on): find out when you were in the same area as someone else who turned it on. It never shows where or when
• Katkee understands what each Story is about, so no hashtags needed
• Follow new people in one tap from their Stories

Safe and private social app
• Private account: approve who follows you
• Two-step login protects your account
• Block, mute and report anyone, any time
• Download your data, or delete your account whenever you like

Made in India, for everyone
• In English, Hindi, Marathi, Spanish, Portuguese, Indonesian, French, German and Arabic
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
Katkee: स्टोरी, स्टेटस और चैट
<!-- /field -->

### Short description
<!-- field:short:hi -->
क्लोज़ फ़्रेंड्स के लिए स्टोरीज़। म्यूज़िक, चैट, वॉइस नोट और वीडियो कॉल।
<!-- /field -->

### Full description
<!-- field:full:hi -->
Katkee आपके असली दोस्तों के लिए स्टोरीज़ ऐप है। फ़ोटो और वीडियो स्टोरीज़ शेयर करें जो स्टेटस की तरह 24 घंटे रहती हैं, म्यूज़िक, टेक्स्ट और एनिमेटेड स्टिकर के साथ, और हर स्टोरी कौन देखे यह आप तय करें। फिर दोस्तों से चैट करें, वॉइस नोट भेजें और वीडियो कॉल करें। अनजान लोगों के लिए नहीं, अपनों के लिए पोस्ट करें।

लोग Katkee क्यों चुनते हैं
• क्लोज़ फ़्रेंड्स: कुछ स्टोरीज़ सिर्फ़ ख़ास लोगों के लिए
• हर स्टोरी के लिए चुनें: सब, फ़ॉलोअर या क्लोज़ फ़्रेंड्स
• होम पर दोस्तों की स्टोरीज़, एक बार में एक स्वाइप
• मुफ़्त, कोई ऐड ट्रैकिंग नहीं, और हम आपका डेटा कभी नहीं बेचते

अपने अंदाज़ की स्टोरीज़ बनाएँ
• फ़ोटो और वीडियो स्टोरीज़ जो स्टेटस की तरह 24 घंटे रहती हैं
• टेक्स्ट स्टाइल, एनिमेटेड स्टिकर, इमोजी, ड्रॉइंग और फ़िल्टर
• फ़िल्टर पूरी फ़ोटो या वीडियो पर, किनारे से किनारे तक
• Katkee की म्यूज़िक लाइब्रेरी से गाना जोड़ें और उसका बेस्ट हिस्सा चुनें
• लेआउट: एक स्टोरी में छह फ़ोटो तक का कोलाज
• पोल, क्विज़, सवाल, काउंटडाउन और लिंक
• त्योहार स्टोरीज़: Katkee आपकी स्टोरी में त्योहार पहचानकर उसे त्योहार रिंग में जोड़ देता है

हमेशा रहने वाली हाइलाइट्स
• अपनी बेस्ट स्टोरीज़ प्रोफ़ाइल पर हाइलाइट्स में हमेशा के लिए रखें
• दोस्त आपकी हाइलाइट्स को लाइक, कमेंट और शेयर कर सकते हैं
• सारी नई स्टोरीज़ देख लीं? दूसरों की हाइलाइट्स देखें

चैट और वीडियो कॉल
• प्राइवेट मैसेज और 32 दोस्तों तक के ग्रुप चैट
• हर चैट में वॉइस नोट, फ़ोटो और वीडियो
• दोस्तों से वॉइस कॉल और वीडियो कॉल
• स्टोरी का जवाब दें, इमोजी से रिएक्ट करें या डबल टैप से लाइक करें
• देखें मैसेज कब भेजा गया, पहुँचा और देखा गया

अपने लोगों से मिलें
• रास्ते टकराए (वैकल्पिक, जब तक आप चालू न करें तब तक बंद): जानें कि आप उस इलाके में थे जहाँ इसे चालू करने वाला कोई और भी था, फिर उनकी पब्लिक स्टोरीज़ देखें। कहाँ या कब, कभी नहीं बताया जाता
• Katkee समझता है कि हर स्टोरी किस बारे में है, हैशटैग की ज़रूरत नहीं
• लोकप्रिय स्टोरीज़ देखें और एक टैप में नए लोगों को फ़ॉलो करें

सुरक्षित और प्राइवेट
• प्राइवेट अकाउंट: तय करें कौन आपको फ़ॉलो करे
• टू-स्टेप लॉगिन से अकाउंट सुरक्षित
• किसी को भी ब्लॉक, म्यूट या रिपोर्ट करें
• अपने डेटा की कॉपी डाउनलोड करें, या जब चाहें अकाउंट डिलीट करें

सबके लिए
• हिंदी, मराठी, अंग्रेज़ी और छह और भाषाओं में
• लाइट और डार्क मोड
• एक फ़ोन पर कई अकाउंट, एक टैप में बदलें
• स्क्रीन रीडर इस्तेमाल करने वालों के लिए तस्वीरों का विवरण

Katkee 18 साल और उससे ज़्यादा उम्र के लोगों के लिए है।
सवाल या सुझाव? support@katkee.com · katkee.com/support
प्राइवेसी पॉलिसी: katkee.com/privacy · शर्तें: katkee.com/terms
<!-- /field -->

## Marathi (mr-IN)

### App name
<!-- field:title:mr -->
Katkee: स्टोरी, स्टेटस आणि चॅट
<!-- /field -->

### Short description
<!-- field:short:mr -->
क्लोज फ्रेंड्ससाठी स्टोरीज. संगीत, चॅट, व्हॉइस नोट आणि व्हिडिओ कॉल.
<!-- /field -->

### Full description
<!-- field:full:mr -->
Katkee तुमच्या खऱ्या मित्रांसाठी स्टोरीज ॲप आहे. स्टेटससारख्या 24 तास राहणाऱ्या फोटो आणि व्हिडिओ स्टोरीज शेअर करा, संगीत, टेक्स्ट आणि ॲनिमेटेड स्टिकरसोबत, आणि प्रत्येक स्टोरी कोण पाहील ते तुम्ही ठरवा. मग मित्रांशी चॅट करा, व्हॉइस नोट पाठवा आणि व्हिडिओ कॉल करा. अनोळखी लोकांसाठी नाही, आपल्या माणसांसाठी पोस्ट करा.

लोक Katkee का निवडतात
• क्लोज फ्रेंड्स: काही स्टोरीज फक्त खास लोकांसाठी
• प्रत्येक स्टोरीसाठी निवडा: सगळे, फॉलोअर किंवा क्लोज फ्रेंड्स
• होमवर मित्रांच्या स्टोरीज, एका वेळी एक स्वाइप
• मोफत, कोणतंही ॲड ट्रॅकिंग नाही, आणि आम्ही तुमचा डेटा कधीच विकत नाही

तुमच्या पद्धतीच्या स्टोरीज बनवा
• स्टेटससारख्या 24 तास राहणाऱ्या फोटो आणि व्हिडिओ स्टोरीज
• टेक्स्ट स्टाइल, ॲनिमेटेड स्टिकर, इमोजी, ड्रॉइंग आणि फिल्टर
• फिल्टर संपूर्ण फोटो किंवा व्हिडिओवर, कडेपासून कडेपर्यंत
• Katkee च्या संगीत लायब्ररीतून गाणं जोडा आणि त्याचा बेस्ट भाग निवडा
• लेआउट: एका स्टोरीत सहा फोटोपर्यंतचा कोलाज
• पोल, क्विझ, प्रश्न, काउंटडाउन आणि लिंक
• सणांच्या स्टोरीज: Katkee तुमच्या स्टोरीतला सण ओळखून तो सणाच्या रिंगमध्ये जोडतो

कायम राहणाऱ्या हायलाइट्स
• तुमच्या बेस्ट स्टोरीज प्रोफाइलवर हायलाइट्समध्ये कायमच्या ठेवा
• मित्र तुमच्या हायलाइट्स लाइक, कमेंट आणि शेअर करू शकतात
• सगळ्या नवीन स्टोरीज पाहिल्या? इतरांच्या हायलाइट्स पाहा

चॅट आणि व्हिडिओ कॉल
• प्रायव्हेट मेसेज आणि 32 मित्रांपर्यंतचे ग्रुप चॅट
• प्रत्येक चॅटमध्ये व्हॉइस नोट, फोटो आणि व्हिडिओ
• मित्रांशी व्हॉइस कॉल आणि व्हिडिओ कॉल
• स्टोरीला उत्तर द्या, इमोजीने रिॲक्ट करा किंवा डबल टॅपने लाइक करा
• मेसेज कधी पाठवला, पोहोचला आणि पाहिला ते पाहा

आपल्या माणसांना भेटा
• रस्ते जुळले (ऐच्छिक, तुम्ही चालू करेपर्यंत बंद): हे चालू केलेलं कोणी आणि तुम्ही एकाच भागात होता का ते कळेल, मग त्यांच्या पब्लिक स्टोरीज पाहा. कुठे किंवा कधी, ते कधीच सांगितलं जात नाही
• Katkee ला प्रत्येक स्टोरी कशाबद्दल आहे ते समजतं, हॅशटॅगची गरज नाही
• लोकप्रिय स्टोरीज पाहा आणि एका टॅपमध्ये नवीन लोकांना फॉलो करा

सुरक्षित आणि प्रायव्हेट
• प्रायव्हेट अकाउंट: तुम्हाला कोण फॉलो करेल ते ठरवा
• टू-स्टेप लॉगिनने अकाउंट सुरक्षित
• कोणालाही ब्लॉक, म्यूट किंवा रिपोर्ट करा
• तुमच्या डेटाची कॉपी डाउनलोड करा, किंवा हवं तेव्हा अकाउंट डिलीट करा

सगळ्यांसाठी
• मराठी, हिंदी, इंग्रजी आणि आणखी सहा भाषांमध्ये
• लाइट आणि डार्क मोड
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

Conoce a tu gente
• Cruces (opcional, desactivado hasta que lo actives): entérate cuando estuviste en la misma zona que alguien que también lo activó. Nunca dónde ni cuándo
• Explora Historias populares y sigue a gente nueva

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

Encontre sua turma
• Caminhos cruzados (opcional, desativado até você ativar): saiba quando esteve na mesma região que alguém que também ativou. Nunca onde nem quando
• Explore Stories populares e siga gente nova

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

Temukan orang-orangmu
• Berpapasan (opsional, mati sampai kamu mengaktifkannya): ketahui saat kamu berada di area yang sama dengan seseorang yang juga mengaktifkannya. Tidak pernah di mana atau kapan
• Jelajahi Story populer dan ikuti orang baru

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

Retrouvez vos proches
• Chemins croisés (facultatif, désactivé tant que vous ne l'activez pas) : sachez quand vous étiez dans le même coin que quelqu'un qui l'a aussi activé. Jamais où ni quand
• Explorez les Stories populaires et suivez de nouvelles personnes

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

Finde deine Leute
• Wege gekreuzt (optional, aus, bis du es einschaltest): erfahre, wann du in derselben Gegend warst wie jemand, der es auch eingeschaltet hat. Nie wo oder wann
• Entdecke beliebte Stories und folge neuen Leuten

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

تعرّف على ناسك
• تقاطع المسارات (اختياري، متوقف حتى تفعّله): اعرف متى كنت في نفس المنطقة مع شخص فعّله أيضًا. لا نذكر أين أو متى أبدًا
• استكشف القصص الشائعة وتابع أشخاصًا جددًا

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
