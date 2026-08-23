import { useState, useRef, useEffect } from 'react';
import styles from './emojiPicker.module.scss';

export interface EmojiEntry {
  char: string;
  name: string;
}

export const EMOJI_CATEGORIES: Record<string, EmojiEntry[]> = {
  'Smileys': [
    { char: '\u{1F600}', name: 'grinning face' },
    { char: '\u{1F603}', name: 'grinning face with big eyes' },
    { char: '\u{1F604}', name: 'grinning face with smiling eyes' },
    { char: '\u{1F601}', name: 'beaming face with smiling eyes' },
    { char: '\u{1F606}', name: 'grinning squinting face' },
    { char: '\u{1F605}', name: 'grinning face with sweat' },
    { char: '\u{1F923}', name: 'rolling on the floor laughing' },
    { char: '\u{1F602}', name: 'face with tears of joy' },
    { char: '\u{1F642}', name: 'slightly smiling face' },
    { char: '\u{1F60A}', name: 'smiling face with smiling eyes' },
    { char: '\u{1F607}', name: 'smiling face with halo' },
    { char: '\u{1F970}', name: 'smiling face with hearts' },
    { char: '\u{1F60D}', name: 'heart eyes' },
    { char: '\u{1F929}', name: 'star struck' },
    { char: '\u{1F618}', name: 'face blowing a kiss' },
    { char: '\u{1F617}', name: 'kissing face' },
    { char: '\u{1F61A}', name: 'kissing face with closed eyes' },
    { char: '\u{1F619}', name: 'kissing face with smiling eyes' },
    { char: '\u{1F972}', name: 'smiling face with tear' },
    { char: '\u{1F60B}', name: 'face savoring food' },
    { char: '\u{1F61B}', name: 'face with tongue' },
    { char: '\u{1F61C}', name: 'winking face with tongue' },
    { char: '\u{1F92A}', name: 'zany face' },
    { char: '\u{1F61D}', name: 'squinting face with tongue' },
    { char: '\u{1F911}', name: 'money mouth face' },
    { char: '\u{1F917}', name: 'hugging face' },
    { char: '\u{1F92D}', name: 'face with hand over mouth' },
    { char: '\u{1FAE2}', name: 'face with open eyes and hand over mouth' },
    { char: '\u{1F92B}', name: 'shushing face' },
    { char: '\u{1F914}', name: 'thinking face' },
    { char: '\u{1FAE1}', name: 'saluting face' },
    { char: '\u{1F910}', name: 'zipper mouth face' },
    { char: '\u{1F928}', name: 'face with raised eyebrow' },
    { char: '\u{1F610}', name: 'neutral face' },
    { char: '\u{1F611}', name: 'expressionless face' },
    { char: '\u{1F636}', name: 'face without mouth' },
    { char: '\u{1FAE5}', name: 'dotted line face' },
    { char: '\u{1F60F}', name: 'smirking face' },
    { char: '\u{1F612}', name: 'unamused face' },
    { char: '\u{1F644}', name: 'face with rolling eyes' },
    { char: '\u{1F62C}', name: 'grimacing face' },
    { char: '\u{1F925}', name: 'lying face' },
    { char: '\u{1F60C}', name: 'relieved face' },
    { char: '\u{1F614}', name: 'pensive face' },
    { char: '\u{1F62A}', name: 'sleepy face' },
    { char: '\u{1F924}', name: 'drooling face' },
    { char: '\u{1F634}', name: 'sleeping face' },
    { char: '\u{1F637}', name: 'face with medical mask' },
    { char: '\u{1F912}', name: 'face with thermometer' },
    { char: '\u{1F915}', name: 'face with head bandage' },
    { char: '\u{1F922}', name: 'nauseated face' },
    { char: '\u{1F92E}', name: 'face vomiting' },
    { char: '\u{1F975}', name: 'hot face' },
    { char: '\u{1F976}', name: 'cold face' },
    { char: '\u{1F974}', name: 'woozy face' },
    { char: '\u{1F635}', name: 'face with crossed out eyes' },
    { char: '\u{1F92F}', name: 'exploding head' },
    { char: '\u{1F920}', name: 'cowboy hat face' },
    { char: '\u{1F973}', name: 'partying face' },
    { char: '\u{1F978}', name: 'disguised face' },
    { char: '\u{1F60E}', name: 'smiling face with sunglasses' },
    { char: '\u{1F913}', name: 'nerd face' },
    { char: '\u{1F9D0}', name: 'face with monocle' },
    { char: '\u{1F615}', name: 'confused face' },
    { char: '\u{1FAE4}', name: 'face with diagonal mouth' },
    { char: '\u{1F61F}', name: 'worried face' },
    { char: '\u{1F641}', name: 'slightly frowning face' },
    { char: '\u2639\uFE0F', name: 'frowning face' },
    { char: '\u{1F62E}', name: 'face with open mouth' },
    { char: '\u{1F62F}', name: 'hushed face' },
    { char: '\u{1F632}', name: 'astonished face' },
    { char: '\u{1F633}', name: 'flushed face' },
    { char: '\u{1F97A}', name: 'pleading face' },
    { char: '\u{1F979}', name: 'face holding back tears' },
    { char: '\u{1F626}', name: 'frowning face with open mouth' },
    { char: '\u{1F627}', name: 'anguished face' },
    { char: '\u{1F628}', name: 'fearful face' },
    { char: '\u{1F630}', name: 'anxious face with sweat' },
    { char: '\u{1F625}', name: 'sad but relieved face' },
    { char: '\u{1F622}', name: 'crying face' },
    { char: '\u{1F62D}', name: 'loudly crying face' },
    { char: '\u{1F631}', name: 'face screaming in fear' },
    { char: '\u{1F616}', name: 'confounded face' },
    { char: '\u{1F623}', name: 'persevering face' },
    { char: '\u{1F61E}', name: 'disappointed face' },
    { char: '\u{1F613}', name: 'downcast face with sweat' },
    { char: '\u{1F629}', name: 'weary face' },
    { char: '\u{1F62B}', name: 'tired face' },
    { char: '\u{1F971}', name: 'yawning face' },
    { char: '\u{1F624}', name: 'face with steam from nose' },
  ],
  'Gestures': [
    { char: '\u{1F44D}', name: 'thumbs up' },
    { char: '\u{1F44E}', name: 'thumbs down' },
    { char: '\u{1F44F}', name: 'clapping hands' },
    { char: '\u{1F64C}', name: 'raising hands' },
    { char: '\u{1F91D}', name: 'handshake' },
    { char: '\u{1F64F}', name: 'folded hands pray' },
    { char: '\u{1F4AA}', name: 'flexed biceps muscle' },
    { char: '\u{1F44B}', name: 'waving hand' },
    { char: '\u270C\uFE0F', name: 'victory hand peace' },
    { char: '\u{1F918}', name: 'sign of the horns rock' },
    { char: '\u{1F44C}', name: 'ok hand' },
    { char: '\u{1F90F}', name: 'pinching hand' },
    { char: '\u{1F90C}', name: 'pinched fingers' },
    { char: '\u{1F448}', name: 'backhand index pointing left' },
    { char: '\u{1F449}', name: 'backhand index pointing right' },
    { char: '\u{1F446}', name: 'backhand index pointing up' },
    { char: '\u{1F447}', name: 'backhand index pointing down' },
    { char: '\u261D\uFE0F', name: 'index pointing up' },
    { char: '\u270B', name: 'raised hand' },
    { char: '\u{1F596}', name: 'vulcan salute' },
  ],
  'Hearts & Symbols': [
    { char: '\u2764\uFE0F', name: 'red heart love' },
    { char: '\u{1F525}', name: 'fire' },
    { char: '\u2B50', name: 'star' },
    { char: '\u2705', name: 'check mark' },
    { char: '\u274C', name: 'cross mark' },
    { char: '\u{1F4AF}', name: 'hundred points' },
    { char: '\u{1F389}', name: 'party popper' },
    { char: '\u{1F38A}', name: 'confetti ball' },
    { char: '\u{1F608}', name: 'smiling face with horns devil' },
    { char: '\u{1F440}', name: 'eyes' },
    { char: '\u{1F480}', name: 'skull' },
    { char: '\u{1F921}', name: 'clown face' },
    { char: '\u{1F4A9}', name: 'pile of poo' },
    { char: '\u{1F47B}', name: 'ghost' },
    { char: '\u{1F47D}', name: 'alien' },
    { char: '\u{1F916}', name: 'robot' },
    { char: '\u{1F49B}', name: 'yellow heart' },
    { char: '\u{1F49A}', name: 'green heart' },
    { char: '\u{1F499}', name: 'blue heart' },
    { char: '\u{1F49C}', name: 'purple heart' },
    { char: '\u{1F5A4}', name: 'black heart' },
    { char: '\u{1F90D}', name: 'white heart' },
    { char: '\u{1F90E}', name: 'brown heart' },
    { char: '\u{1F494}', name: 'broken heart' },
    { char: '\u{1F495}', name: 'two hearts' },
    { char: '\u{1F496}', name: 'sparkling heart' },
    { char: '\u{1F497}', name: 'growing heart' },
    { char: '\u{1F493}', name: 'beating heart' },
    { char: '\u{1F49E}', name: 'revolving hearts' },
    { char: '\u{1F48C}', name: 'love letter' },
  ],
  'Nature': [
    { char: '\u{1F436}', name: 'dog face' },
    { char: '\u{1F431}', name: 'cat face' },
    { char: '\u{1F42D}', name: 'mouse face' },
    { char: '\u{1F439}', name: 'hamster' },
    { char: '\u{1F430}', name: 'rabbit face' },
    { char: '\u{1F98A}', name: 'fox' },
    { char: '\u{1F43B}', name: 'bear' },
    { char: '\u{1F43C}', name: 'panda' },
    { char: '\u{1F428}', name: 'koala' },
    { char: '\u{1F42F}', name: 'tiger face' },
    { char: '\u{1F981}', name: 'lion' },
    { char: '\u{1F42E}', name: 'cow face' },
    { char: '\u{1F437}', name: 'pig face' },
    { char: '\u{1F438}', name: 'frog' },
    { char: '\u{1F435}', name: 'monkey face' },
    { char: '\u{1F649}', name: 'hear no evil monkey' },
    { char: '\u{1F64A}', name: 'speak no evil monkey' },
    { char: '\u{1F412}', name: 'monkey' },
    { char: '\u{1F414}', name: 'chicken' },
    { char: '\u{1F427}', name: 'penguin' },
  ],
  'Food': [
    { char: '\u{1F34E}', name: 'red apple' },
    { char: '\u{1F34A}', name: 'tangerine orange' },
    { char: '\u{1F34B}', name: 'lemon' },
    { char: '\u{1F34C}', name: 'banana' },
    { char: '\u{1F349}', name: 'watermelon' },
    { char: '\u{1F347}', name: 'grapes' },
    { char: '\u{1F353}', name: 'strawberry' },
    { char: '\u{1F348}', name: 'melon' },
    { char: '\u{1F352}', name: 'cherries' },
    { char: '\u{1F351}', name: 'peach' },
    { char: '\u{1F354}', name: 'hamburger' },
    { char: '\u{1F355}', name: 'pizza' },
    { char: '\u{1F32E}', name: 'taco' },
    { char: '\u{1F32F}', name: 'burrito' },
    { char: '\u{1F37F}', name: 'popcorn' },
    { char: '\u{1F366}', name: 'ice cream' },
    { char: '\u{1F370}', name: 'cake shortcake' },
    { char: '\u{1F382}', name: 'birthday cake' },
    { char: '\u{1F36A}', name: 'cookie' },
    { char: '\u2615', name: 'hot beverage coffee' },
  ],
  'Travel & Places': [
    { char: '\u{1F30D}', name: 'globe showing Europe Africa' },
    { char: '\u{1F30E}', name: 'globe showing Americas' },
    { char: '\u{1F30F}', name: 'globe showing Asia Australia' },
    { char: '\u{1F310}', name: 'globe with meridians' },
    { char: '\u{1F5FA}', name: 'world map' },
    { char: '\u{1F3D4}', name: 'snow-capped mountain' },
    { char: '\u26F0\uFE0F', name: 'mountain' },
    { char: '\u{1F30B}', name: 'volcano' },
    { char: '\u{1F3D5}', name: 'camping' },
    { char: '\u{1F3D6}', name: 'beach with umbrella' },
    { char: '\u{1F3DC}', name: 'desert' },
    { char: '\u{1F3DD}', name: 'desert island' },
    { char: '\u{1F3DE}', name: 'national park' },
    { char: '\u{1F3DF}', name: 'stadium' },
    { char: '\u{1F3DB}', name: 'classical building' },
    { char: '\u{1F3D7}', name: 'building construction' },
    { char: '\u{1F3D8}', name: 'houses' },
    { char: '\u{1F3DA}', name: 'derelict house' },
    { char: '\u{1F3E0}', name: 'house' },
    { char: '\u{1F3E1}', name: 'house with garden' },
    { char: '\u{1F3E2}', name: 'office building' },
    { char: '\u{1F3E3}', name: 'Japanese post office' },
    { char: '\u{1F3E5}', name: 'hospital' },
    { char: '\u{1F3E6}', name: 'bank' },
    { char: '\u{1F3E8}', name: 'hotel' },
    { char: '\u{1F3EA}', name: 'convenience store' },
    { char: '\u{1F3EB}', name: 'school' },
    { char: '\u26EA', name: 'church' },
    { char: '\u{1F54C}', name: 'mosque' },
    { char: '\u{1F54D}', name: 'synagogue' },
    { char: '\u26F2', name: 'fountain' },
    { char: '\u26FA', name: 'tent' },
    { char: '\u{1F301}', name: 'foggy' },
    { char: '\u{1F303}', name: 'night with stars' },
    { char: '\u{1F304}', name: 'sunrise over mountains' },
    { char: '\u{1F305}', name: 'sunrise' },
    { char: '\u{1F306}', name: 'cityscape at dusk' },
    { char: '\u{1F307}', name: 'sunset' },
    { char: '\u{1F309}', name: 'bridge at night' },
    { char: '\u{1F680}', name: 'rocket' },
    { char: '\u2708\uFE0F', name: 'airplane' },
    { char: '\u{1F6E9}', name: 'small airplane' },
    { char: '\u{1F681}', name: 'helicopter' },
    { char: '\u{1F682}', name: 'locomotive' },
    { char: '\u{1F683}', name: 'railway car' },
    { char: '\u{1F684}', name: 'high-speed train' },
    { char: '\u{1F685}', name: 'bullet train' },
    { char: '\u{1F697}', name: 'automobile car' },
    { char: '\u{1F695}', name: 'taxi' },
    { char: '\u{1F68C}', name: 'bus' },
    { char: '\u{1F6F3}', name: 'passenger ship' },
    { char: '\u26F5', name: 'sailboat' },
    { char: '\u{1F6A2}', name: 'ship' },
    { char: '\u{1F6B2}', name: 'bicycle' },
    { char: '\u{1F3CE}', name: 'racing car' },
    { char: '\u{1F3CD}', name: 'motorcycle' },
  ],
  'Activities': [
    { char: '\u26BD', name: 'soccer ball football' },
    { char: '\u{1F3C0}', name: 'basketball' },
    { char: '\u{1F3C8}', name: 'american football' },
    { char: '\u26BE', name: 'baseball' },
    { char: '\u{1F94E}', name: 'softball' },
    { char: '\u{1F3BE}', name: 'tennis' },
    { char: '\u{1F3D0}', name: 'volleyball' },
    { char: '\u{1F3C9}', name: 'rugby football' },
    { char: '\u{1F94F}', name: 'flying disc frisbee' },
    { char: '\u{1F3B1}', name: 'pool 8 ball billiards' },
    { char: '\u{1F3D3}', name: 'ping pong table tennis' },
    { char: '\u{1F3F8}', name: 'badminton' },
    { char: '\u{1F94A}', name: 'boxing glove' },
    { char: '\u{1F94B}', name: 'martial arts uniform' },
    { char: '\u{1F945}', name: 'goal net' },
    { char: '\u26F3', name: 'flag in hole golf' },
    { char: '\u26F8\uFE0F', name: 'ice skate' },
    { char: '\u{1F3A3}', name: 'fishing pole' },
    { char: '\u{1F3BD}', name: 'running shirt' },
    { char: '\u{1F3BF}', name: 'skis' },
    { char: '\u{1F6F7}', name: 'sled' },
    { char: '\u{1F94C}', name: 'curling stone' },
    { char: '\u{1F3AF}', name: 'bullseye direct hit' },
    { char: '\u{1F3AE}', name: 'video game controller' },
    { char: '\u{1F579}', name: 'joystick' },
    { char: '\u{1F3B2}', name: 'game die dice' },
    { char: '\u{1F9E9}', name: 'puzzle piece jigsaw' },
    { char: '\u265F\uFE0F', name: 'chess pawn' },
    { char: '\u{1F3AD}', name: 'performing arts theater' },
    { char: '\u{1F3A8}', name: 'artist palette paint' },
    { char: '\u{1F3AC}', name: 'clapper board movie' },
    { char: '\u{1F3A4}', name: 'microphone karaoke' },
    { char: '\u{1F3A7}', name: 'headphone music' },
    { char: '\u{1F3B5}', name: 'musical note' },
    { char: '\u{1F3B6}', name: 'musical notes' },
    { char: '\u{1F3B9}', name: 'musical keyboard piano' },
    { char: '\u{1F941}', name: 'drum' },
    { char: '\u{1F3B7}', name: 'saxophone' },
    { char: '\u{1F3BA}', name: 'trumpet' },
    { char: '\u{1F3B8}', name: 'guitar' },
  ],
  'Objects': [
    { char: '\u231A', name: 'watch' },
    { char: '\u{1F4F1}', name: 'mobile phone' },
    { char: '\u{1F4F2}', name: 'mobile phone with arrow' },
    { char: '\u{1F4BB}', name: 'laptop computer' },
    { char: '\u{1F5A5}', name: 'desktop computer' },
    { char: '\u{1F5A8}', name: 'printer' },
    { char: '\u2328\uFE0F', name: 'keyboard' },
    { char: '\u{1F5B1}', name: 'computer mouse' },
    { char: '\u{1F4BD}', name: 'computer disk minidisc' },
    { char: '\u{1F4BF}', name: 'optical disk CD' },
    { char: '\u{1F4C0}', name: 'DVD' },
    { char: '\u{1F4F7}', name: 'camera' },
    { char: '\u{1F4F8}', name: 'camera with flash' },
    { char: '\u{1F4F9}', name: 'video camera' },
    { char: '\u{1F3A5}', name: 'movie camera' },
    { char: '\u{1F4FA}', name: 'television' },
    { char: '\u{1F4FB}', name: 'radio' },
    { char: '\u{1F50B}', name: 'battery' },
    { char: '\u{1F50C}', name: 'electric plug' },
    { char: '\u{1F4A1}', name: 'light bulb idea' },
    { char: '\u{1F526}', name: 'flashlight' },
    { char: '\u{1F56F}', name: 'candle' },
    { char: '\u{1F4D5}', name: 'closed book' },
    { char: '\u{1F4D6}', name: 'open book' },
    { char: '\u{1F4D7}', name: 'green book' },
    { char: '\u{1F4D8}', name: 'blue book' },
    { char: '\u{1F4D9}', name: 'orange book' },
    { char: '\u{1F4DA}', name: 'books' },
    { char: '\u{1F4D3}', name: 'notebook' },
    { char: '\u{1F4D2}', name: 'ledger' },
    { char: '\u{1F4DC}', name: 'scroll' },
    { char: '\u{1F4DD}', name: 'memo pencil' },
    { char: '\u{1F4CE}', name: 'paperclip' },
    { char: '\u{1F4CC}', name: 'pushpin' },
    { char: '\u{1F4CF}', name: 'straight ruler' },
    { char: '\u2702\uFE0F', name: 'scissors' },
    { char: '\u{1F512}', name: 'locked' },
    { char: '\u{1F513}', name: 'unlocked' },
    { char: '\u{1F511}', name: 'key' },
    { char: '\u{1F528}', name: 'hammer' },
    { char: '\u{1F527}', name: 'wrench' },
    { char: '\u{1F529}', name: 'nut and bolt' },
    { char: '\u2699\uFE0F', name: 'gear' },
    { char: '\u{1F9F2}', name: 'magnet' },
    { char: '\u{1F52E}', name: 'crystal ball' },
    { char: '\u{1F4B0}', name: 'money bag' },
    { char: '\u{1F4B3}', name: 'credit card' },
    { char: '\u{1F48E}', name: 'gem stone diamond' },
    { char: '\u{1F3FA}', name: 'amphora' },
  ],
  'Flags': [
    { char: '\u{1F3C1}', name: 'chequered flag' },
    { char: '\u{1F6A9}', name: 'triangular flag' },
    { char: '\u{1F3F4}', name: 'black flag' },
    { char: '\u{1F3F3}\uFE0F', name: 'white flag' },
    { char: '\u{1F3F3}\uFE0F\u200D\u{1F308}', name: 'rainbow flag pride' },
    { char: '\u{1F3F3}\uFE0F\u200D\u26A7\uFE0F', name: 'transgender flag' },
    { char: '\u{1F3F4}\u200D\u2620\uFE0F', name: 'pirate flag' },
    { char: '\u{1F1FA}\u{1F1F8}', name: 'flag United States' },
    { char: '\u{1F1EC}\u{1F1E7}', name: 'flag United Kingdom' },
    { char: '\u{1F1E8}\u{1F1E6}', name: 'flag Canada' },
    { char: '\u{1F1E6}\u{1F1FA}', name: 'flag Australia' },
    { char: '\u{1F1E9}\u{1F1EA}', name: 'flag Germany' },
    { char: '\u{1F1EB}\u{1F1F7}', name: 'flag France' },
    { char: '\u{1F1EA}\u{1F1F8}', name: 'flag Spain' },
    { char: '\u{1F1EE}\u{1F1F9}', name: 'flag Italy' },
    { char: '\u{1F1EF}\u{1F1F5}', name: 'flag Japan' },
    { char: '\u{1F1F0}\u{1F1F7}', name: 'flag South Korea' },
    { char: '\u{1F1E8}\u{1F1F3}', name: 'flag China' },
    { char: '\u{1F1F7}\u{1F1FA}', name: 'flag Russia' },
    { char: '\u{1F1E7}\u{1F1F7}', name: 'flag Brazil' },
    { char: '\u{1F1EE}\u{1F1F3}', name: 'flag India' },
    { char: '\u{1F1F2}\u{1F1FD}', name: 'flag Mexico' },
    { char: '\u{1F1F3}\u{1F1F1}', name: 'flag Netherlands' },
    { char: '\u{1F1F8}\u{1F1EA}', name: 'flag Sweden' },
    { char: '\u{1F1F3}\u{1F1F4}', name: 'flag Norway' },
    { char: '\u{1F1F5}\u{1F1F1}', name: 'flag Poland' },
    { char: '\u{1F1F9}\u{1F1F7}', name: 'flag Turkey' },
    { char: '\u{1F1F8}\u{1F1E6}', name: 'flag Saudi Arabia' },
    { char: '\u{1F1E6}\u{1F1EA}', name: 'flag United Arab Emirates' },
    { char: '\u{1F1FF}\u{1F1E6}', name: 'flag South Africa' },
  ],
};

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export const EmojiPicker = ({ onSelect, onClose }: EmojiPickerProps) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const allEmojis = Object.values(EMOJI_CATEGORIES).flat();

  const filteredEmojis = search
    ? allEmojis.filter(entry => {
        const term = search.toLowerCase();
        return entry.name.toLowerCase().includes(term);
      })
    : null;

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
    onClose();
  };

  return (
    <div className={styles.picker} ref={pickerRef} role="dialog" aria-label="Emoji picker">
      <div className={styles.header}>
        <input
          className={styles.search}
          placeholder="Search emoji"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {!search && (
        <div className={styles.categories}>
          {Object.keys(EMOJI_CATEGORIES).map(cat => (
            <button
              key={cat}
              className={`${styles.categoryBtn} ${activeCategory === cat ? styles.activeCat : ''}`}
              onClick={() => setActiveCategory(cat)}
              title={cat}
              type="button"
            >
              {EMOJI_CATEGORIES[cat]?.[0]?.char}
            </button>
          ))}
        </div>
      )}

      <div className={styles.grid}>
        {search ? (
          <>
            <div className={styles.categoryLabel}>Search Results</div>
            <div className={styles.emojiGrid}>
              {filteredEmojis && filteredEmojis.length > 0 ? (
                filteredEmojis.map((entry, i) => (
                  <button key={i} className={styles.emoji} onClick={() => handleEmojiClick(entry.char)} title={entry.name} type="button" data-emoji={entry.char}>
                    {entry.char}
                  </button>
                ))
              ) : (
                <div className={styles.noResults}>No emoji found</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={styles.categoryLabel}>{activeCategory}</div>
            <div className={styles.emojiGrid}>
              {(EMOJI_CATEGORIES[activeCategory] ?? []).map((entry, i) => (
                <button key={i} className={styles.emoji} onClick={() => handleEmojiClick(entry.char)} title={entry.name} type="button" data-emoji={entry.char}>
                  {entry.char}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
