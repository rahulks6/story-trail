#!/usr/bin/env bash
# The "Apne Log" voices (Amazon Polly, Mumbai region) and sound effects, into the folder given:
#   bash brand/promo/apne-log/voices.sh <dir>
# Riya and the end line: Kajal (neural, Hindi + Indian English). Zoya: Aditi. Meera: Raveena.
set -euo pipefail
D=${1:?folder}; mkdir -p "$D"; cd "$D"
say() { aws polly synthesize-speech --region ap-south-1 --voice-id "$2" --engine "$3" --language-code "$4" --text-type ssml --text "<speak>$5</speak>" --output-format mp3 --sample-rate 24000 "$1.mp3" >/dev/null; }
say l1 Kajal neural hi-IN '<prosody rate="115%">आठ सौ followers के लिए Story कौन डालता है?</prosody>'
say l2 Kajal neural hi-IN '<prosody rate="112%">मैं तो सिर्फ़ अपने आठ के लिए डालती हूँ।</prosody>'
say l3 Kajal neural hi-IN '<prosody rate="112%">Lecture bunk, chai पे चलें? <break time="200ms"/> सिर्फ़ Close Friends के लिए।</prosody>'
say l4 Aditi standard hi-IN '<prosody rate="110%">अरे मैं आ रही हूँ! Wait करना!</prosody>'
say l7 Kajal neural hi-IN '<prosody rate="108%">Finally, सब आ गए!</prosody>'
say l8a Kajal neural hi-IN '<prosody rate="110%">Get well soon, Meera!</prosody>'
say l8b Aditi standard hi-IN '<prosody rate="110%">Get well soon, Meera!</prosody>'
say l8c Raveena standard en-IN '<prosody rate="110%">Get well soon, Meera!</prosody>'
say l9 Raveena standard en-IN '<prosody rate="105%">Aww, thank you guys! Next time, I am coming!</prosody>'
say l10 Kajal neural hi-IN '<prosody rate="100%">मेरा दिन... <break time="200ms"/> मेरे लोग।</prosody>'
say l11 Kajal neural hi-IN '<prosody rate="105%">Katkee. <break time="200ms"/> सिर्फ़ अपनों के लिए। <break time="150ms"/> आज ही download करो!</prosody>'
# Zoya's line as a voice note: phone-band EQ.
ffmpeg -v error -y -i l4.mp3 -af "highpass=f=320,lowpass=f=3400,volume=1.2" l4p.wav
# Sound effects, synthesized.
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.45:c=pink:a=0.5" -af "bandpass=f=1800:width_type=h:w=2500,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.25,volume=0.7" whoosh.wav
ffmpeg -v error -y -f lavfi -i "sine=f=1700:d=0.06" -af "afade=t=out:st=0:d=0.06,volume=0.6" tap.wav
ffmpeg -v error -y -f lavfi -i "sine=f=1318:d=0.35" -f lavfi -i "sine=f=1760:d=0.4" -filter_complex "[0]afade=t=out:st=0:d=0.35[a];[1]adelay=110,afade=t=out:st=0.11:d=0.4[b];[a][b]amix=2:normalize=0,volume=0.45" ding.wav
ffmpeg -v error -y -f lavfi -i "sine=f=880:d=0.12" -af "afade=t=out:st=0:d=0.12,volume=0.6" pop.wav
ffmpeg -v error -y -f lavfi -i "sine=f=440:d=1.6" -f lavfi -i "sine=f=480:d=1.6" -filter_complex "[0][1]amix=2:normalize=0,volume=0.25,volume='if(lt(mod(t,0.8),0.4),1,0)':eval=frame,afade=t=out:st=1.3:d=0.3" ring.wav
