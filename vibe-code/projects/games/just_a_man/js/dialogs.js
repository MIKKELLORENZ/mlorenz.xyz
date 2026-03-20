/* ============================================
   JUST A MAN - Dialog Trees
   Every conversation, branch, and choice
   ============================================ */

/*
 Dialog format:
 {
   id: 'DIALOG_ID',
   scene: 'scene_id' or null (keep current),
   speaker: 'NPC NAME' or 'NARRATOR' or null,
   text: 'Dialog text...',
   choices: [
     {
       text: 'Choice text',
       effects: { cash, reputation, charm, stress, trust: {npcId: amount} },
       setFlags: { flagName: value },
       next: 'NEXT_DIALOG_ID' or null (end),
       condition: function() {} // optional availability check
     }
   ],
   // OR for non-choice (click to continue):
   next: 'NEXT_DIALOG_ID',
   onEnter: function() {} // optional side effects when dialog starts
 }
*/

const DIALOGS = {};

// Helper to register dialogs
function D(id, data) {
    DIALOGS[id] = { id, ...data };
}

// ============================================
// DAY 1 OPENING SEQUENCE
// ============================================

D('OPENING_1', {
    scene: 'special_day1_wakeup',
    speaker: 'NARRATOR',
    text: 'October 3rd, 1992. You wake up to the sound of car horns and a dripping faucet. The last of your savings: fifty bucks and a dream. Time to make something of yourself.',
    next: 'OPENING_2',
});

D('OPENING_2', {
    speaker: 'NARRATOR',
    text: 'Your pager sits dead on the nightstand. You can\'t even afford batteries yet. But you\'ve got two hands and a brain. That\'s gotta count for something.',
    next: 'OPENING_3',
});

D('OPENING_3', {
    scene: 'home_starter_morning',
    speaker: 'NARRATOR',
    text: 'Not much to look at. A mattress, your boombox with dead batteries, and a mini fridge with one Cherry Coke left. Let\'s get out there.',
    next: null, // returns to action menu
});

// ============================================
// VINNIE - PAWN SHOP
// ============================================

D('VINNIE_INTRO', {
    scene: 'vinnie_first_meeting',
    speaker: 'VINNIE',
    text: 'Hey, fresh face. You buying or selling? ...You look like you ain\'t got nothin\' to sell.',
    onEnter() { setNpcMet('vinnie'); setFlag('metVinnie', true); },
    choices: [
        {
            text: '"I\'m looking to make some money. Any advice?"',
            next: 'VINNIE_ADVICE',
            effects: { trust: { vinnie: 5 } },
        },
        {
            text: '"Just looking around."',
            next: 'VINNIE_BRUSH_OFF',
            effects: { trust: { vinnie: 0 } },
        },
        {
            text: '"Nice place you got here." (sarcastic)',
            next: 'VINNIE_OFFENDED',
            effects: { trust: { vinnie: -5 } },
        },
    ],
});

D('VINNIE_ADVICE', {
    scene: 'vinnie_friendly',
    speaker: 'VINNIE',
    text: 'Advice? Kid, I look like a guidance counselor to you? ...Alright, listen. You want money, you gotta think like money. Buy low, sell high. Find stuff people threw away, clean it up, bring it here.',
    next: 'VINNIE_ADVICE_2',
});

D('VINNIE_ADVICE_2', {
    speaker: 'VINNIE',
    text: 'Or go to the mall. Rich kids dump stuff at the secondhand bins all the time. Bring it to me, I\'ll give you a fair price. Well... my version of fair.',
    onEnter() { setFlag('learnedHustle', true); },
    next: null,
});

D('VINNIE_BRUSH_OFF', {
    speaker: 'VINNIE',
    text: 'This ain\'t a museum, pal. You wanna look, go to the Met. You wanna deal, we deal.',
    next: null,
});

D('VINNIE_OFFENDED', {
    speaker: 'VINNIE',
    text: '*narrows eyes* "You being smart with me? I been running this shop since before you were born. Show some respect or get out."',
    next: null,
});

D('VINNIE_MARCUS_INTRO', {
    scene: 'vinnie_conspiratorial',
    speaker: 'VINNIE',
    text: 'Hey kid, c\'mere. I want to tell you something.',
    next: 'VINNIE_MARCUS_INTRO_2',
});

D('VINNIE_MARCUS_INTRO_2', {
    speaker: 'VINNIE',
    text: 'You\'ve been doing good. Solid. Reminds me of this other kid I knew, \'cept he went legit. Real legit. Name\'s Marcus, works at the Bull & Bear brokerage downtown.',
    next: 'VINNIE_MARCUS_INTRO_3',
});

D('VINNIE_MARCUS_INTRO_3', {
    speaker: 'VINNIE',
    text: 'Tell him Vinnie sent you. He owes me a favor.',
    choices: [
        {
            text: '"Thanks, Vinnie. I appreciate it."',
            effects: { trust: { vinnie: 3 } },
            setFlags: { stockBrokerageUnlocked: true },
            next: 'VINNIE_MARCUS_RESPONSE_NICE',
        },
        {
            text: '"Stocks? Isn\'t that for rich people?"',
            effects: { trust: { vinnie: 1 } },
            setFlags: { stockBrokerageUnlocked: true },
            next: 'VINNIE_MARCUS_RESPONSE_DOUBT',
        },
    ],
});

D('VINNIE_MARCUS_RESPONSE_NICE', {
    speaker: 'VINNIE',
    text: 'Yeah, yeah. Don\'t get sentimental on me. Just go make some real money so you can come back here and buy my expensive stuff.',
    next: null,
});

D('VINNIE_MARCUS_RESPONSE_DOUBT', {
    speaker: 'VINNIE',
    text: 'It\'s for smart people. And you ain\'t dumb. Mostly.',
    next: null,
});

D('VINNIE_CHAT_FRIENDLY', {
    scene: 'vinnie_friendly',
    speaker: 'VINNIE',
    text: 'Hey, kid. How\'s the hustle treating you? You look like you\'re doing alright.',
    choices: [
        {
            text: '"Getting there. One deal at a time."',
            effects: { trust: { vinnie: 2 } },
            next: null,
        },
        {
            text: '"Any hot tips today?"',
            next: 'VINNIE_CHAT_TIP',
        },
        {
            text: '"Just passing through."',
            next: null,
        },
    ],
});

D('VINNIE_CHAT_TIP', {
    speaker: 'VINNIE',
    text: 'Tip? Here\'s a tip: never trust a man who wears sunglasses indoors. Also, I heard electronics are moving fast this week. Walkmans especially.',
    next: null,
});

// ============================================
// DIANA - CAFE / ROMANCE
// ============================================

D('DIANA_FIRST_MEETING', {
    scene: 'diana_first_sighting',
    speaker: 'NARRATOR',
    text: 'You notice a woman sitting alone, sketching in a notebook. She has a Cherry Coke and headphones around her neck.',
    choices: [
        {
            text: '(Approach her) "Hi, is this seat taken?"',
            next: 'DIANA_APPROACH',
            setFlags: { metDiana: true },
            onSelect() { setNpcMet('diana'); },
        },
        {
            text: '(Order coffee and sit nearby, don\'t approach)',
            next: 'DIANA_SHY',
            setFlags: { noticedDiana: true },
        },
        {
            text: '(Ignore her, focus on your coffee)',
            next: null,
        },
    ],
});

D('DIANA_APPROACH', {
    scene: 'diana_first_conversation',
    speaker: 'DIANA',
    text: '*looks up* "Oh, uh, no. Go ahead."\n\n*She goes back to sketching, then glances at you.*\n\n"Sorry, I\'m kind of in the zone. I\'m Diana."',
    choices: [
        {
            text: '"What are you drawing?"',
            next: 'DIANA_DRAWING',
        },
        {
            text: '"Nice to meet you. I\'m just grabbing coffee."',
            next: 'DIANA_POLITE',
            effects: { trust: { diana: 2 } },
        },
    ],
});

D('DIANA_DRAWING', {
    speaker: 'DIANA',
    text: '"It\'s a logo for a client. Freelance design work. Pays the bills. Mostly."\n\n*She shows you the sketch -- it\'s a retro diner sign.*',
    choices: [
        {
            text: '"That\'s really good!"',
            effects: { trust: { diana: 5 } },
            next: 'DIANA_COMPLIMENT',
        },
        {
            text: '"Cool. So how do you like this place?"',
            effects: { trust: { diana: 2 } },
            next: 'DIANA_CAFE_CHAT',
        },
    ],
});

D('DIANA_COMPLIMENT', {
    speaker: 'DIANA',
    text: '*smiles* "Thanks. Most people don\'t care about design stuff. It\'s nice to meet someone who actually looks."',
    next: null,
});

D('DIANA_CAFE_CHAT', {
    speaker: 'DIANA',
    text: '"Joe\'s? It\'s my second office. Good coffee, good Cherry Coke, nobody bothers you. Usually." *slight smirk*',
    next: null,
});

D('DIANA_POLITE', {
    speaker: 'DIANA',
    text: '"Nice to meet you too."\n\n*Polite but brief. She returns to her work.*',
    next: null,
});

D('DIANA_SHY', {
    speaker: 'NARRATOR',
    text: 'You sit near the sketching woman but don\'t say anything. She glances at you once, then returns to her work. Maybe next time.',
    next: null,
});

D('DIANA_CAFE_CHAT_1', {
    scene: 'diana_coffee_date',
    speaker: 'DIANA',
    text: '"Oh hey! Back for more of Joe\'s finest?"',
    choices: [
        {
            text: '"Can I buy you a Cherry Coke?"',
            effects: { cash: -2, trust: { diana: 5 } },
            next: 'DIANA_COKE_ACCEPT',
            condition() { return gameState.cash >= 2; },
        },
        {
            text: '"Hey Diana. How\'s the design work going?"',
            effects: { trust: { diana: 2 } },
            next: 'DIANA_WORK_CHAT',
        },
        {
            text: '(Just nod and sit down)',
            next: null,
        },
    ],
});

D('DIANA_COKE_ACCEPT', {
    speaker: 'DIANA',
    text: '"You know what, sure. Nobody\'s offered to buy me a drink here before. Usually it\'s guys at bars."\n\n"So what do you do? You seem like you\'re... figuring things out."',
    choices: [
        {
            text: '"I\'m hustling. Buying and selling stuff. It\'s not glamorous but it\'s honest. Mostly."',
            effects: { trust: { diana: 3 } },
            next: 'DIANA_RESPECTS_HUSTLE',
        },
        {
            text: '"I\'m an entrepreneur." (exaggeration)',
            effects: { trust: { diana: 1 }, charm: 1 },
            next: 'DIANA_AMUSED',
        },
        {
            text: '"Honestly? I\'m broke and trying not to be."',
            effects: { trust: { diana: 5 } },
            next: 'DIANA_HONEST',
        },
    ],
});

D('DIANA_RESPECTS_HUSTLE', {
    speaker: 'DIANA',
    text: '*laughs* "I respect that. Everyone\'s gotta start somewhere. I ate ramen for three months when I started freelancing."',
    next: null,
});

D('DIANA_AMUSED', {
    speaker: 'DIANA',
    text: '"Uh huh." *she\'s not convinced but amused* "Well, entrepreneur, don\'t let me keep you from your empire."',
    next: null,
});

D('DIANA_HONEST', {
    speaker: 'DIANA',
    text: '*genuinely sympathetic* "Been there. When I started freelancing, I ate ramen for three months straight. It gets better. I promise."',
    next: null,
});

D('DIANA_WORK_CHAT', {
    speaker: 'DIANA',
    text: '"It\'s going. Got a new client -- a record store wants a whole rebrand. Fun stuff. I\'m designing their logo, flyers, the works."',
    next: null,
});

D('DIANA_DATE_ASK', {
    scene: 'diana_coffee_date',
    speaker: 'DIANA',
    text: '"You know, I realized we\'ve been hanging out at this cafe a lot. It\'s kind of become our thing."',
    choices: [
        {
            text: '"Would you want to do something outside the cafe? Maybe dinner?"',
            next: 'DIANA_DATE_RESPONSE',
        },
        {
            text: '"Yeah, this is nice. I like it here."',
            effects: { trust: { diana: 2 } },
            next: 'DIANA_DATE_CONTENT',
        },
        {
            text: '"I actually have to run. Busy day."',
            effects: { trust: { diana: -2 } },
            next: null,
        },
    ],
});

D('DIANA_DATE_RESPONSE', {
    speaker: 'DIANA',
    text: '*pauses, then smiles* "Are you asking me on a date?"',
    choices: [
        {
            text: '"Yeah. I am."',
            effects: { trust: { diana: 8 } },
            setFlags: { firstDate: true },
            next: 'DIANA_DATE_YES',
            onSelect() { advanceDianaStage('dating'); },
        },
        {
            text: '"Only if you want to. No pressure."',
            effects: { trust: { diana: 10 } },
            setFlags: { firstDate: true },
            next: 'DIANA_DATE_YES',
            onSelect() { advanceDianaStage('dating'); },
        },
    ],
});

D('DIANA_DATE_YES', {
    speaker: 'DIANA',
    text: '"I\'d like that. There\'s this Italian place, La Bella Vita. It\'s not cheap but it\'s worth it."',
    next: null,
});

D('DIANA_DATE_CONTENT', {
    speaker: 'DIANA',
    text: '"Me too." *she seems slightly disappointed but content*',
    next: null,
});

D('DIANA_FIRST_DATE', {
    scene: 'diana_dinner_date',
    speaker: 'DIANA',
    text: '"Wow, this is nice. I haven\'t been out like this in months. Work has been crazy."',
    onEnter() { setFlag('dianaDinnerDate', true); },
    choices: [
        {
            text: '"Tell me about yourself. What\'s your story?"',
            next: 'DIANA_STORY',
        },
        {
            text: '"You look amazing tonight."',
            next: 'DIANA_COMPLIMENT_DATE',
        },
        {
            text: '"So, this menu... prices are something."',
            effects: { trust: { diana: -1 }, stress: 1 },
            next: 'DIANA_CHEAP',
        },
    ],
});

D('DIANA_STORY', {
    speaker: 'DIANA',
    text: '"Born and raised here. Studied art at community college, couldn\'t afford to finish. Started doing design work -- logos, flyers, album covers. It\'s good work when it\'s there."\n\n"What about you? What\'s the dream?"',
    choices: [
        {
            text: '"I want to own property, build something real. Something that lasts."',
            effects: { trust: { diana: 5 } },
            next: 'DIANA_LIKES_STABILITY',
        },
        {
            text: '"I want to be rich. Like, really rich."',
            effects: { trust: { diana: 0 } },
            next: 'DIANA_MONEY_TALK',
        },
        {
            text: '"Honestly? I\'m figuring it out day by day."',
            effects: { trust: { diana: 7 } },
            next: 'DIANA_HONEST_DATE',
        },
    ],
});

D('DIANA_LIKES_STABILITY', {
    speaker: 'DIANA',
    text: '"I like that. Stability is underrated. Everyone wants flash, nobody wants foundation."',
    next: null,
});

D('DIANA_MONEY_TALK', {
    speaker: 'DIANA',
    text: '*slight frown* "Money\'s important, I get it. But it\'s not everything. The richest people I\'ve done design work for were the most miserable."',
    next: null,
});

D('DIANA_HONEST_DATE', {
    speaker: 'DIANA',
    text: '"At least you\'re honest about it. Most guys pretend they have it all figured out. That\'s way more exhausting than just being real."',
    next: null,
});

D('DIANA_COMPLIMENT_DATE', {
    speaker: 'DIANA',
    text: function() {
        if (gameState.charm >= 30) {
            return '*blushes* "Thank you. You clean up pretty nice yourself."';
        }
        return '*slight smile* "Thanks. That\'s sweet." *but she seems to think it might be a line*';
    },
    effects: function() {
        return { trust: { diana: gameState.charm >= 30 ? 3 : 1 } };
    },
    next: null,
});

D('DIANA_CHEAP', {
    speaker: 'DIANA',
    text: '*laughs* "Don\'t worry about it. Let\'s just enjoy the evening."\n\n*She noticed the penny-pinching. File that away.*',
    next: null,
});

D('DIANA_LOVE_CONFESSION', {
    scene: 'diana_love_confession',
    speaker: 'DIANA',
    text: '"Can I tell you something?"',
    choices: [
        {
            text: '"Of course."',
            next: 'DIANA_LOVE_WORDS',
        },
        {
            text: '"Actually, there\'s something I want to say first."',
            next: 'DIANA_PLAYER_FIRST',
        },
    ],
});

D('DIANA_LOVE_WORDS', {
    speaker: 'DIANA',
    text: '"I... I think I\'m falling for you. I know that sounds crazy. We haven\'t known each other that long. But you\'re different. You\'re real."',
    choices: [
        {
            text: '"I\'m falling for you too, Diana."',
            effects: { trust: { diana: 15 } },
            next: 'DIANA_LOVE_MUTUAL',
            onSelect() { advanceDianaStage('committed'); },
        },
        {
            text: '"I care about you a lot. Let\'s see where this goes."',
            effects: { trust: { diana: 5 } },
            next: 'DIANA_LOVE_PATIENT',
        },
        {
            text: '"Diana, I like you, but I have a lot going on right now."',
            effects: { trust: { diana: -10 } },
            next: 'DIANA_LOVE_REJECT',
        },
    ],
});

D('DIANA_LOVE_MUTUAL', {
    speaker: 'DIANA',
    text: '*tears up slightly* "Really? God, I was so nervous to say that. I\'ve been thinking about it for days."',
    next: null,
});

D('DIANA_LOVE_PATIENT', {
    speaker: 'DIANA',
    text: '"That\'s fair. I can be patient. I just needed you to know."',
    next: null,
});

D('DIANA_LOVE_REJECT', {
    speaker: 'DIANA',
    text: '*hurt* "I see. I put myself out there and you... okay. I get it."',
    next: null,
});

D('DIANA_PLAYER_FIRST', {
    speaker: 'NARRATOR',
    text: '"I love you, Diana."',
    next: 'DIANA_PLAYER_FIRST_2',
});

D('DIANA_PLAYER_FIRST_2', {
    speaker: 'DIANA',
    text: '*stunned, then beaming* "You beat me to it. I love you too."',
    effects: { trust: { diana: 20 } },
    onEnter() { advanceDianaStage('committed'); },
    next: null,
});

D('DIANA_PROPOSAL', {
    scene: 'diana_proposal',
    speaker: 'NARRATOR',
    text: 'This is it. You reach into your pocket and feel the small box.',
    choices: [
        {
            text: '(Propose)',
            next: 'DIANA_PROPOSAL_SPEECH',
        },
        {
            text: '(Not yet -- enjoy the dinner)',
            next: null,
        },
    ],
});

D('DIANA_PROPOSAL_SPEECH', {
    speaker: 'YOU',
    text: '"Diana, I know we haven\'t had the easiest road. But I can\'t imagine walking it with anyone else. Will you... will you be my partner? In everything?"',
    next: 'DIANA_PROPOSAL_ANSWER',
});

D('DIANA_PROPOSAL_ANSWER', {
    speaker: 'DIANA',
    text: function() {
        const trust = gameState.npcs.diana.trust;
        if (trust >= 80) {
            return '*crying happy tears* "Yes. YES. Oh my god, yes."';
        } else if (trust >= 60) {
            return '"I... I love you. But I\'m not sure I\'m ready for that. Can we just... keep being us for now?"';
        } else {
            return '"I care about you. But we have a lot to work through. I can\'t say yes right now."';
        }
    },
    onEnter() {
        const trust = gameState.npcs.diana.trust;
        setFlag('proposedToDiana', true);
        if (trust >= 80) {
            setFlag('dianaResponse', 'accepted');
        } else if (trust >= 60) {
            setFlag('dianaResponse', 'not_yet');
            modifyNpcTrust('diana', -5);
        } else {
            setFlag('dianaResponse', 'rejected');
            modifyNpcTrust('diana', -15);
        }
    },
    next: null,
});

D('DIANA_BREAKUP', {
    scene: 'diana_breakup',
    speaker: 'DIANA',
    text: '"I heard something. About you and Ray. Some warehouse deal? Is that true?"',
    choices: [
        {
            text: '"Yeah, it happened. I needed the money."',
            effects: { trust: { diana: -10 } },
            next: 'DIANA_BREAKUP_HONEST',
        },
        {
            text: '"It\'s not what you think."',
            next: 'DIANA_BREAKUP_LIE',
        },
        {
            text: '"It\'s none of your business."',
            effects: { trust: { diana: -30 } },
            next: 'DIANA_BREAKUP_RUDE',
        },
    ],
});

D('DIANA_BREAKUP_HONEST', {
    speaker: 'DIANA',
    text: '"I get it, I do. But that stuff is dangerous. Please be careful. For me?"',
    next: null,
});

D('DIANA_BREAKUP_LIE', {
    speaker: 'DIANA',
    text: function() {
        if (gameState.charm >= 40) {
            return '"Don\'t lie to me. ...Fine. But I\'m watching you."';
        }
        return '"Don\'t lie to me. I can handle the truth. I can\'t handle dishonesty."';
    },
    onEnter() {
        modifyNpcTrust('diana', gameState.charm >= 40 ? -15 : -25);
    },
    next: null,
});

D('DIANA_BREAKUP_RUDE', {
    speaker: 'DIANA',
    text: '"Wow. Okay then."',
    onEnter() {
        gameState.flags.dianaRudeCount++;
        checkDianaBreakup();
    },
    next: null,
});

// ============================================
// MARCUS - STOCK BROKER
// ============================================

D('MARCUS_CAFE_INTRO', {
    scene: 'marcus_first_meeting',
    speaker: 'MARCUS',
    text: '"You know what I love about this place? No phones ringing. Just coffee and quiet."',
    choices: [
        {
            text: '"Rough day?"',
            next: 'MARCUS_INTRO_CHAT',
            onSelect() { setNpcMet('marcus'); setFlag('metMarcus', true); setFlag('stockBrokerageUnlocked', true); },
        },
        {
            text: '(Mind your own business)',
            next: null,
        },
    ],
});

D('MARCUS_INTRO_CHAT', {
    speaker: 'MARCUS',
    text: '"Every day on the floor is rough. But that\'s where the money is. Marcus." *extends hand*',
    choices: [
        {
            text: '"What floor are you talking about?"',
            effects: { trust: { marcus: 5 } },
            next: 'MARCUS_EXPLAINS',
        },
    ],
});

D('MARCUS_EXPLAINS', {
    speaker: 'MARCUS',
    text: '"The trading floor. Bull & Bear Brokerage. I move numbers around and occasionally they move in the right direction. You should come by sometime."',
    next: null,
});

D('BROKERAGE_FIRST_VISIT', {
    scene: 'marcus_brokerage_intro',
    speaker: 'MARCUS',
    text: '"Welcome to the jungle, my friend. This is where dreams are made and broken. Every. Single. Day."',
    choices: [
        {
            text: '"How do I get started?"',
            next: 'MARCUS_TUTORIAL',
        },
        {
            text: '"This seems complicated."',
            effects: { trust: { marcus: 2 } },
            next: 'MARCUS_REASSURE',
        },
        {
            text: '"Vinnie sent me."',
            effects: { trust: { marcus: 10 } },
            next: 'MARCUS_VINNIE_REF',
            condition() { return gameState.flags.metVinnie && gameState.npcs.vinnie.trust >= 50; },
        },
    ],
});

D('MARCUS_TUTORIAL', {
    speaker: 'MARCUS',
    text: '"Simple. You pick a stock, you buy low, you pray it goes up, you sell high. Or you listen to me and improve your odds significantly. Minimum buy-in is fifty bucks."',
    next: null,
});

D('MARCUS_REASSURE', {
    speaker: 'MARCUS',
    text: '"It IS complicated. That\'s why most people lose money. But you and me? We\'re not most people."',
    next: null,
});

D('MARCUS_VINNIE_REF', {
    speaker: 'MARCUS',
    text: '"Old Vinnie! How is that cantankerous SOB? Alright, any friend of Vinnie\'s gets the VIP treatment. Let me show you the ropes."',
    next: null,
});

D('MARCUS_TIP', {
    scene: 'marcus_stock_tip',
    speaker: 'MARCUS',
    text: function() {
        const tip = getMarcusTip();
        gameState._lastTip = tip;
        const dirWord = tip.direction === 'up' ? 'about to pop' : 'going to tank';
        return `"Hey, between you and me... ${tip.ticker} is ${dirWord}. I\'d act on that if I were you."`;
    },
    next: null,
});

D('MARCUS_BETRAYAL', {
    scene: 'marcus_stock_tip',
    speaker: 'MARCUS',
    text: '"Hey, listen. I\'ve got something huge. NOVA is about to announce a revolutionary product. I\'m talking stock price doubles overnight. Put everything you can into it."',
    choices: [
        {
            text: '"All in. Let\'s do this."',
            next: 'MARCUS_BETRAYAL_ALLIN',
            setFlags: { marcusBetrayalTriggered: true },
        },
        {
            text: '"Let me think about it."',
            next: 'MARCUS_BETRAYAL_WAIT',
        },
        {
            text: '"I don\'t go all-in on anything."',
            next: 'MARCUS_BETRAYAL_DECLINE',
        },
    ],
});

D('MARCUS_BETRAYAL_ALLIN', {
    speaker: 'NARRATOR',
    text: 'You put everything into NOVA. Marcus grins and shakes your hand.\n\n...The next morning, NOVA crashes 40%.',
    next: 'MARCUS_BETRAYAL_AFTERMATH',
});

D('MARCUS_BETRAYAL_AFTERMATH', {
    scene: 'marcus_betrayal_reveal',
    speaker: 'NARRATOR',
    text: function() {
        if (gameState.npcs.marcus.trust >= 70) {
            return 'Marcus shows up at the cafe, looking sick.';
        }
        return 'You hear through the grapevine that Marcus shorted NOVA before the crash. He played you.';
    },
    next: function() {
        return gameState.npcs.marcus.trust >= 70 ? 'MARCUS_CONFESSION' : 'MARCUS_BETRAYAL_DISCOVERED';
    },
});

D('MARCUS_CONFESSION', {
    scene: 'marcus_confession',
    speaker: 'MARCUS',
    text: '"I... I have to tell you something. That tip was bad. Worse than bad. I set you up. I\'m sorry, man. I got in deep with some people and I panicked."',
    choices: [
        {
            text: '"You backstabbing piece of--"',
            effects: { trust: { marcus: -100 } },
            setFlags: { marcusBetrayalRevealed: true },
            next: null,
        },
        {
            text: '"Why?"',
            effects: { trust: { marcus: -30 } },
            setFlags: { marcusBetrayalRevealed: true },
            next: 'MARCUS_EXPLAINS_WHY',
        },
    ],
});

D('MARCUS_EXPLAINS_WHY', {
    speaker: 'MARCUS',
    text: '"I owed money to the wrong people. A lot of money. They said if I didn\'t make it back they\'d... look, it doesn\'t matter. What I did was wrong. I\'ll make it up to you. Somehow."',
    next: null,
});

D('MARCUS_BETRAYAL_DISCOVERED', {
    speaker: 'NARRATOR',
    text: 'Marcus avoids your calls. The brokerage staff won\'t look you in the eye. You got played.',
    onEnter() { setFlag('marcusBetrayalRevealed', true); gameState.npcs.marcus.trust = 0; },
    next: null,
});

D('MARCUS_BETRAYAL_WAIT', {
    speaker: 'MARCUS',
    text: '"Clock\'s ticking, my friend. This window won\'t stay open forever."',
    next: null,
});

D('MARCUS_BETRAYAL_DECLINE', {
    speaker: 'MARCUS',
    text: '"Your call. But don\'t say I didn\'t warn you."',
    next: null,
});

// ============================================
// RAY - SHADY DEALER
// ============================================

D('RAY_INTRO', {
    scene: 'ray_first_meeting',
    speaker: 'RAY',
    text: '"Hey. Hey, you. Yeah, you. You look like someone who could use some extra cash."',
    choices: [
        {
            text: '"Who are you?"',
            next: 'RAY_PITCH',
            onSelect() { setNpcMet('ray'); setFlag('rayIntroduced', true); },
        },
        {
            text: '"I\'m not interested in trouble."',
            effects: { trust: { ray: 0 } },
            next: 'RAY_INTRO_DECLINE',
            onSelect() { setFlag('rayIntroduced', true); },
        },
        {
            text: '(Walk away silently)',
            effects: { trust: { ray: -3 } },
            next: null,
            onSelect() { setFlag('rayIntroduced', true); },
        },
    ],
});

D('RAY_INTRO_DECLINE', {
    speaker: 'RAY',
    text: '"Trouble? Nah, man. This is just business. Informal business. Think about it."',
    onEnter() { setNpcMet('ray'); },
    next: null,
});

D('RAY_PITCH', {
    scene: 'ray_pitching_deal',
    speaker: 'RAY',
    text: '"Name\'s Ray. I\'m... a facilitator. I help things move from point A to point B. Nothing heavy. Electronics, surplus goods. Fell off a truck, you know?"',
    next: 'RAY_FIRST_DEAL',
});

D('RAY_FIRST_DEAL', {
    speaker: 'RAY',
    text: '"Here\'s the deal. You front fifty bucks. I double it in two days. Simple."',
    choices: [
        {
            text: '"Alright, let\'s do it."',
            next: 'RAY_DEAL_ACCEPT',
            condition() { return gameState.cash >= 50; },
            onSelect() {
                modifyCash(-50);
                setFlag('tookRayDeal', true);
                const result = resolveRayDeal(50);
                gameState.pendingEvents.push({
                    type: 'ray_deal_result',
                    day: gameState.currentDay + 2,
                    result,
                    investAmount: 50,
                });
            },
        },
        {
            text: '"Fifty\'s too rich for me right now."',
            next: 'RAY_DEAL_LATER',
        },
        {
            text: '"No thanks. This sounds like trouble."',
            effects: { trust: { ray: -5 } },
            next: 'RAY_DEAL_REFUSE',
        },
    ],
});

D('RAY_DEAL_ACCEPT', {
    speaker: 'RAY',
    text: '"Smart man. Come find me in two days. I\'ll have your money."',
    next: null,
});

D('RAY_DEAL_LATER', {
    speaker: 'RAY',
    text: '"Alright, when you\'re ready, you know where to find me."',
    next: null,
});

D('RAY_DEAL_REFUSE', {
    speaker: 'RAY',
    text: '"Your loss, man."',
    next: null,
});

D('RAY_DEAL_SUCCESS', {
    scene: 'ray_deal_success',
    speaker: 'RAY',
    text: function() {
        const payout = gameState._pendingPayout || 150;
        return `"Told you, man. Here\'s your cut. $${payout}. Pleasure doing business."`;
    },
    onEnter() {
        const payout = gameState._pendingPayout || 150;
        modifyCash(payout);
        modifyNpcTrust('ray', 10);
        gameState.dealsCompleted++;
    },
    next: null,
});

D('RAY_DEAL_FAILURE', {
    scene: 'ray_deal_failure',
    speaker: 'RAY',
    text: '"Look, man, I\'m sorry. The deal went south. Some guys got pinched. Your money\'s gone."',
    onEnter() {
        modifyNpcTrust('ray', 3);
        modifyStress(5);
    },
    next: null,
});

D('RAY_BIG_DEAL', {
    scene: 'ray_pitching_deal',
    speaker: 'RAY',
    text: '"Listen, I got something big. A warehouse full of electronics -- TVs, stereos, the works. \'Surplus.\' I need you to put in a thousand bucks. We move it all in one night for five times what we put in."',
    choices: [
        {
            text: '"I\'m in. Let\'s do it."',
            next: 'RAY_BIG_DEAL_ACCEPT',
            condition() { return gameState.cash >= 1000; },
            onSelect() {
                modifyCash(-1000);
                setFlag('tookRayBigDeal', true);
                const result = resolveRayBigDeal(1000);
                gameState.pendingEvents.push({
                    type: 'ray_big_deal_result',
                    day: gameState.currentDay + 2,
                    result,
                });
            },
        },
        {
            text: '"A thousand\'s too much. Five hundred?"',
            next: 'RAY_BIG_DEAL_HALF',
            condition() { return gameState.cash >= 500; },
            onSelect() {
                modifyCash(-500);
                setFlag('tookRayBigDeal', true);
                const result = resolveRayBigDeal(500);
                gameState.pendingEvents.push({
                    type: 'ray_big_deal_result',
                    day: gameState.currentDay + 2,
                    result,
                    halfDeal: true,
                });
            },
        },
        {
            text: '"No. This is too risky."',
            effects: { trust: { ray: -3 } },
            next: 'RAY_BIG_DEAL_REFUSE',
        },
    ],
});

D('RAY_BIG_DEAL_ACCEPT', {
    speaker: 'RAY',
    text: '"My man. This is gonna be huge. Lay low for two days and then come find me."',
    next: null,
});

D('RAY_BIG_DEAL_HALF', {
    speaker: 'RAY',
    text: '"Five hundred? ...Alright, smaller cut for you then. Deal."',
    next: null,
});

D('RAY_BIG_DEAL_REFUSE', {
    speaker: 'RAY',
    text: '"Alright, man. I get it. No hard feelings."',
    next: null,
});

D('RAY_BIG_DEAL_SUCCESS', {
    scene: 'ray_deal_success',
    speaker: 'RAY',
    text: function() {
        const payout = gameState._pendingPayout || 3000;
        return `"WE DID IT! Here\'s your cut -- $${payout}!"`;
    },
    onEnter() {
        const payout = gameState._pendingPayout || 3000;
        modifyCash(payout);
        modifyNpcTrust('ray', 10);
        modifyStress(5);
        gameState.dealsCompleted++;
        if (randomChance(0.25)) setFlag('dianaCaughtRay', true);
    },
    next: null,
});

D('RAY_BIG_DEAL_PARTIAL', {
    scene: 'ray_deal_failure',
    speaker: 'RAY',
    text: function() {
        const payout = gameState._pendingPayout || 1500;
        return `"Things got complicated. We moved half before things got hot. Here\'s ${payout}."`;
    },
    onEnter() {
        const payout = gameState._pendingPayout || 1500;
        modifyCash(payout);
        modifyNpcTrust('ray', 5);
        modifyStress(8);
    },
    next: null,
});

D('RAY_BIG_DEAL_DISASTER', {
    scene: 'ray_deal_failure',
    speaker: 'RAY',
    text: '"Man, I\'m SO sorry. Cops raided the warehouse. I barely got out. Your money\'s gone."',
    onEnter() {
        modifyNpcTrust('ray', 3);
        modifyStress(15);
        modifyReputation(-5);
    },
    next: null,
});

D('RAY_FAMILY', {
    scene: 'ray_family_crisis',
    speaker: 'RAY',
    text: '"Hey man. Listen, I... I need to talk to you about something. Not business."',
    onEnter() { setFlag('rayFamilyOffered', true); },
    choices: [
        {
            text: '"What\'s going on?"',
            next: 'RAY_FAMILY_EXPLAIN',
        },
        {
            text: '"Not now, Ray. I\'m busy."',
            effects: { trust: { ray: -10 } },
            next: null,
        },
    ],
});

D('RAY_FAMILY_EXPLAIN', {
    speaker: 'RAY',
    text: '"My daughter, Keisha. She\'s sick. Real sick. And the doctors... they want two grand for the treatment. I don\'t have it, man. These deals I\'m running, it\'s all for her."',
    choices: [
        {
            text: '"I\'ll lend you the money."',
            condition() { return gameState.cash >= 2000; },
            next: 'RAY_FAMILY_HELP',
            onSelect() {
                modifyCash(-2000);
                setFlag('rayFamilyHelped', true);
                setFlag('rayPaybackRemaining', 2500);
                modifyNpcTrust('ray', 20);
                modifyReputation(5);
            },
        },
        {
            text: '"I\'m sorry, Ray. I can\'t afford that right now."',
            effects: { trust: { ray: 2 } },
            next: 'RAY_FAMILY_CANT',
        },
        {
            text: '"That\'s rough, man. I hope you figure it out."',
            next: 'RAY_FAMILY_SYMPATHY',
        },
    ],
});

D('RAY_FAMILY_HELP', {
    scene: 'ray_grateful',
    speaker: 'RAY',
    text: '*stunned* "You... you serious? Man, I don\'t know what to say. I\'ll pay you back. Every cent. With interest. You just saved my little girl."',
    next: null,
});

D('RAY_FAMILY_CANT', {
    speaker: 'RAY',
    text: '"Yeah... yeah, I understand. Forget I said anything."',
    next: null,
});

D('RAY_FAMILY_SYMPATHY', {
    speaker: 'RAY',
    text: '"...Yeah. Me too."',
    next: null,
});

// ============================================
// MRS. CHEN - REAL ESTATE
// ============================================

D('CHEN_INTRO', {
    scene: 'chen_office_intro',
    speaker: 'MRS. CHEN',
    text: '"Yes? Do you have an appointment?"',
    onEnter() { setNpcMet('mrsChen'); setFlag('metMrsChen', true); setFlag('realEstateOfficeUnlocked', true); },
    choices: [
        {
            text: '"No, but I\'m looking to buy property."',
            next: 'CHEN_INTRO_HONEST',
        },
        {
            text: '"Tony sent me."',
            condition() { return gameState.npcs.tony.met && gameState.npcs.tony.trust >= 50; },
            effects: { trust: { mrsChen: 10 } },
            next: 'CHEN_INTRO_TONY',
        },
        {
            text: '"I\'m building my future."',
            effects: { trust: { mrsChen: 3 } },
            next: 'CHEN_INTRO_FUTURE',
        },
    ],
});

D('CHEN_INTRO_HONEST', {
    speaker: 'MRS. CHEN',
    text: '*looks you over carefully* "Buying property is a serious commitment. It\'s not like buying... sneakers. How much capital are you working with?"',
    choices: [
        {
            text: '(Tell the truth about your cash)',
            effects: { trust: { mrsChen: 5 } },
            next: 'CHEN_SHOWS_LISTINGS',
        },
        {
            text: '"Enough." (evasive)',
            effects: { trust: { mrsChen: -5 } },
            next: 'CHEN_UNIMPRESSED',
        },
    ],
});

D('CHEN_INTRO_TONY', {
    speaker: 'MRS. CHEN',
    text: '"Ah, Tony. He\'s a character, but he has good instincts about people. Sit down."',
    next: 'CHEN_SHOWS_LISTINGS',
});

D('CHEN_INTRO_FUTURE', {
    speaker: 'MRS. CHEN',
    text: '*small smile* "Good answer. Let\'s see if you mean it."',
    next: 'CHEN_SHOWS_LISTINGS',
});

D('CHEN_UNIMPRESSED', {
    speaker: 'MRS. CHEN',
    text: '"I deal in specifics, not bravado. Come back when you\'re ready to be serious."',
    next: null,
});

D('CHEN_SHOWS_LISTINGS', {
    scene: 'chen_showing_listings',
    speaker: 'MRS. CHEN',
    text: '"Let me show you what\'s available in your range."',
    next: null, // opens property browser
});

D('CHEN_DEAL_CLOSE', {
    scene: 'chen_closing_deal',
    speaker: 'MRS. CHEN',
    text: function() {
        return '"Congratulations. You\'re now a property owner. Treat it well."';
    },
    onEnter() {
        modifyNpcTrust('mrsChen', 8);
        if (!gameState.flags.firstPropertyBought) setFlag('firstPropertyBought', true);
    },
    next: null,
});

D('CHEN_CROWN_JEWEL', {
    scene: 'chen_crown_jewel',
    speaker: 'MRS. CHEN',
    text: '"I don\'t show this to just anyone. But you\'ve proven yourself. The Lexington Tower Penthouse. My crown jewel."',
    next: null,
});

// ============================================
// TONY - NIGHTCLUB
// ============================================

D('TONY_INTRO', {
    scene: 'tony_nightclub_intro',
    speaker: 'TONY',
    text: '"Yo yo yo! Fresh blood! Welcome to Club Neon, baby! I\'m Tony. I own this beautiful establishment."',
    onEnter() { setNpcMet('tony'); setFlag('metTony', true); setFlag('nightclubUnlocked', true); },
    choices: [
        {
            text: '"Great place, Tony. How do I become a regular?"',
            effects: { trust: { tony: 5 }, reputation: 3 },
            next: 'TONY_REGULAR',
        },
        {
            text: '"I\'m here to network."',
            effects: { trust: { tony: 3 }, reputation: 2 },
            next: 'TONY_NETWORK',
        },
        {
            text: '"How much for drinks?"',
            effects: { trust: { tony: 1 } },
            next: 'TONY_DRINKS',
        },
    ],
});

D('TONY_REGULAR', {
    speaker: 'TONY',
    text: '"Just keep showing up, spending money, and not starting fights. Simple rules for a complicated world."',
    next: null,
});

D('TONY_NETWORK', {
    speaker: 'TONY',
    text: '"A man who knows what he wants! I like that. Stick with me, I know everybody in this city."',
    next: null,
});

D('TONY_DRINKS', {
    speaker: 'TONY',
    text: '"First one\'s on the house. After that, you\'re on your own. Capitalism, baby!"',
    onEnter() { modifyStress(-3); },
    next: null,
});

D('TONY_PARTNERSHIP', {
    scene: 'tony_partnership_offer',
    speaker: 'TONY',
    text: '"I\'ve been thinking. Club Neon is doing good, but I want to expand. Open a second location uptown. I need a partner. Ten grand buys you in. You get 30% of profits. That\'s about three hundred a day, easy."',
    choices: [
        {
            text: '"Partners." *shakes hand*',
            condition() { return gameState.cash >= 10000; },
            next: 'TONY_PARTNERSHIP_ACCEPT',
            onSelect() {
                modifyCash(-10000);
                setFlag('tonyPartnership', true);
                setFlag('tonyPartnershipDay', gameState.currentDay);
                recalcPassiveIncome();
            },
        },
        {
            text: '"What are the risks?"',
            next: 'TONY_PARTNERSHIP_RISKS',
        },
        {
            text: '"Not right now, Tony."',
            next: 'TONY_PARTNERSHIP_LATER',
        },
    ],
});

D('TONY_PARTNERSHIP_ACCEPT', {
    scene: 'tony_celebration',
    speaker: 'TONY',
    text: '"NOW we\'re talking! Partners! This is gonna be beautiful, baby!"',
    next: null,
});

D('TONY_PARTNERSHIP_RISKS', {
    speaker: 'TONY',
    text: '"It\'s a nightclub, not a war zone. Worst case, we break even. Best case, we\'re printing money."',
    choices: [
        {
            text: '"Alright, I\'m in."',
            condition() { return gameState.cash >= 10000; },
            next: 'TONY_PARTNERSHIP_ACCEPT',
            onSelect() {
                modifyCash(-10000);
                setFlag('tonyPartnership', true);
                recalcPassiveIncome();
            },
        },
        {
            text: '"Let me think about it."',
            next: 'TONY_PARTNERSHIP_LATER',
        },
    ],
});

D('TONY_PARTNERSHIP_LATER', {
    speaker: 'TONY',
    text: '"Offer\'s open. For now."',
    next: null,
});

D('TONY_MAJOR_DEAL', {
    scene: 'tony_major_deal',
    speaker: 'TONY',
    text: '"Alright, sit down. I\'m about to change your life. There\'s a building going up on 5th Avenue. The developer needs investors. Fifty thousand gets you a 20% stake. This thing is worth half a million when it\'s done. But you\'ve got three days."',
    onEnter() { setFlag('majorDealOffered', true); },
    choices: [
        {
            text: '"I\'m in. Let me get the money together."',
            next: 'TONY_MAJOR_ACCEPT',
            onSelect() {
                setFlag('majorDealAccepted', true);
                setFlag('majorDealTimer', 3);
            },
        },
        {
            text: '"Fifty thousand? I need to think about this."',
            next: 'TONY_MAJOR_THINK',
        },
        {
            text: '"Too rich for my blood."',
            effects: { trust: { tony: -5 } },
            next: 'TONY_MAJOR_DECLINE',
        },
    ],
});

D('TONY_MAJOR_ACCEPT', {
    speaker: 'TONY',
    text: '"That\'s what I wanted to hear. Three days. Get that money together and we change the game."',
    next: null,
});

D('TONY_MAJOR_THINK', {
    speaker: 'TONY',
    text: '"Clock\'s ticking, my friend. Three days."',
    next: null,
});

D('TONY_MAJOR_DECLINE', {
    speaker: 'TONY',
    text: '"No shame in knowing your limits. But this was the opportunity of a lifetime."',
    next: null,
});

D('TONY_MAJOR_SUCCESS', {
    scene: 'tony_celebration',
    speaker: 'TONY',
    text: '"We did it, baby! The building\'s a hit! Your stake is worth $120,000. Here\'s your return."',
    onEnter() {
        modifyCash(120000);
        modifyReputation(20);
        setFlag('majorDealOutcome', 'success');
    },
    next: null,
});

// ============================================
// ACT TRANSITIONS
// ============================================

D('ACT1_TO_ACT2', {
    scene: 'special_act1_to_act2',
    speaker: 'NARRATOR',
    text: 'You\'ve been at this for a while now. The hustle is real, and it\'s working. You\'ve got some cash, Vinnie actually nods at you when you walk in, and you\'re starting to understand how this city works.',
    next: 'ACT1_TO_ACT2_B',
});

D('ACT1_TO_ACT2_B', {
    speaker: 'NARRATOR',
    text: 'But fifty-dollar pawn shop deals aren\'t going to get you where you want to be. Time to think bigger.',
    onEnter() { setFlag('act2Unlocked', true); setFlag('currentAct', 2); AudioManager.playMusicForAct(2); },
    next: null,
});

D('ACT2_TO_ACT3', {
    scene: 'special_act2_to_act3',
    speaker: 'NARRATOR',
    text: 'Ten thousand dollars. You can barely believe it. A few weeks ago you had fifty bucks and a dream. Now you\'ve got capital, contacts, and momentum.',
    next: 'ACT2_TO_ACT3_B',
});

D('ACT2_TO_ACT3_B', {
    speaker: 'NARRATOR',
    text: 'But this is where it gets real. Property. Investment. Commitment. The stakes just got a whole lot higher.',
    onEnter() { setFlag('act3Unlocked', true); setFlag('currentAct', 3); AudioManager.playMusicForAct(3); },
    next: null,
});

// ============================================
// WIN / LOSE DIALOGS
// ============================================

D('WIN_ENDING', {
    scene: 'special_win_ending',
    speaker: 'NARRATOR',
    text: 'You did it.',
    next: 'WIN_ENDING_2',
});

D('WIN_ENDING_2', {
    speaker: 'NARRATOR',
    text: 'Three properties. A woman who loves you. More money than you ever dreamed. Not bad for someone who started with fifty bucks and a dead pager.',
    next: 'WIN_ENDING_3',
});

D('WIN_ENDING_3', {
    scene: 'diana_win_ending',
    speaker: 'DIANA',
    text: '"Good morning, sleepyhead. I made coffee."',
    next: 'WIN_ENDING_4',
});

D('WIN_ENDING_4', {
    speaker: 'NARRATOR',
    text: 'October 3rd, 1992 feels like a lifetime ago. You came to this city with nothing but ambition. And somehow, against all odds...\n\nYou made it. You\'re just a man. But what a man you turned out to be.',
    next: null,
});

D('LOSE_BANKRUPT', {
    scene: 'special_gameover_bankrupt',
    speaker: 'NARRATOR',
    text: 'You check your pockets. Empty. You check your apartment. Nothing worth selling. The fridge is empty except for a flat Cherry Coke.',
    next: 'LOSE_BANKRUPT_2',
});

D('LOSE_BANKRUPT_2', {
    speaker: 'NARRATOR',
    text: 'The city doesn\'t care about your dreams. It chews people up and spits them out. Today, you\'re the one being spit out.',
    next: null,
});

D('LOSE_BURNOUT', {
    scene: 'special_gameover_burnout',
    speaker: 'NARRATOR',
    text: 'You can\'t sleep. You can\'t eat. Every deal feels like a trap. Every person feels like a threat. Your hands won\'t stop shaking.',
    next: 'LOSE_BURNOUT_2',
});

D('LOSE_BURNOUT_2', {
    speaker: 'NARRATOR',
    text: 'The doctor says it\'s burnout. Severe anxiety. You need to stop. But if you stop, you lose everything.\n\nSometimes the hustle wins. And you lose.',
    next: null,
});

// ============================================
// GENERIC NPC CHATS (fallback)
// ============================================

D('RAY_CHAT', {
    scene: null,
    speaker: 'RAY',
    text: function() {
        const trust = gameState.npcs.ray.trust;
        if (gameState.flags.rayFamilyHelped) return '"Hey man. Keisha\'s doing great. I owe you everything. Need anything moved? I got you."';
        if (trust >= 40) return '"What\'s good? I might have something cooking. Come back soon."';
        return '"Hey. You know where to find me."';
    },
    next: null,
});

D('TONY_CHAT', {
    scene: 'tony_vip_chat',
    speaker: 'TONY',
    text: function() {
        const trust = gameState.npcs.tony.trust;
        if (trust >= 60) return '"My favorite person! Come, sit. Let me tell you about what\'s happening in this city."';
        if (trust >= 30) return '"Hey hey! Good to see you. The usual?"';
        return '"Welcome back. Drinks are at the bar."';
    },
    onEnter() {
        const trust = gameState.npcs.tony.trust;
        if (trust >= 70) { modifyReputation(5); modifyCharm(1); }
        else if (trust >= 50) { modifyReputation(3); }
        else if (trust >= 30) { modifyReputation(2); }
        else { modifyReputation(1); }
        incrementNpcInteractions('tony');
    },
    next: null,
});

D('CHEN_CHAT', {
    scene: null,
    speaker: 'MRS. CHEN',
    text: function() {
        const trust = gameState.npcs.mrsChen.trust;
        if (trust >= 60) return '"Good to see you again. I may have some new listings that would interest you."';
        if (trust >= 30) return '"Hello. Anything I can help you with today?"';
        return '"Yes?"';
    },
    onEnter() { incrementNpcInteractions('mrsChen'); },
    next: null,
});

// ============================================
// DIALOG ENGINE HELPER
// ============================================

function getDialog(id) {
    const d = DIALOGS[id];
    if (!d) return null;

    // Resolve dynamic text
    const resolved = { ...d };
    if (typeof resolved.text === 'function') resolved.text = resolved.text();
    if (typeof resolved.next === 'function') resolved.next = resolved.next();
    if (typeof resolved.effects === 'function') resolved.effects = resolved.effects();

    return resolved;
}
