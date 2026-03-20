/* ============================================
   JUST A MAN - Scene Registry
   Maps scene IDs to image paths, colors, descriptions
   ============================================ */

const SCENES = {
    // === LOCATION BACKGROUNDS ===
    // Home - Starter
    home_starter_morning: {
        image: '../../shared_assets/images/home_starter_morning.png',
        color: '#3a2a1a',
        label: 'Your Apartment - Morning',
        description: 'Your cramped studio. Sunlight through dirty blinds.'
    },
    home_starter_noon: {
        image: '../../shared_assets/images/home_starter_noon.png',
        color: '#4a3a2a',
        label: 'Your Apartment - Afternoon',
        description: 'Harsh midday light. Every stain visible.'
    },
    home_starter_night: {
        image: '../../shared_assets/images/home_starter_night.png',
        color: '#0a0a2e',
        label: 'Your Apartment - Night',
        description: 'Blue TV glow. The city hums outside.'
    },
    // Home - Upgraded
    home_upgraded_morning: {
        image: '../../shared_assets/images/home_upgraded_morning.png',
        color: '#5a4a2a',
        label: 'Your Place - Morning',
        description: 'Warm morning light. A real bed. Progress.'
    },
    home_upgraded_noon: {
        image: '../../shared_assets/images/home_upgraded_noon.png',
        color: '#6a5a3a',
        label: 'Your Place - Afternoon',
        description: 'Bright, airy. Clean and organized.'
    },
    home_upgraded_night: {
        image: '../../shared_assets/images/home_upgraded_night.png',
        color: '#1a1a3e',
        label: 'Your Place - Night',
        description: 'Warm lamp light. City sparkles outside.'
    },
    // Park
    park_morning: {
        image: '../../shared_assets/images/park_morning.png',
        color: '#2a4a1a',
        label: 'Central Park - Morning',
        description: 'Dappled sunlight. Joggers on the path.'
    },
    park_noon: {
        image: '../../shared_assets/images/park_noon.png',
        color: '#3a6a2a',
        label: 'Central Park - Afternoon',
        description: 'Bright sun. People everywhere.'
    },
    park_night: {
        image: '../../shared_assets/images/park_night.png',
        color: '#0a1a2e',
        label: 'Central Park - Night',
        description: 'Lamp-lit paths. Fireflies near the pond.'
    },
    // Mall
    mall_noon: {
        image: '../../shared_assets/images/mall_noon.png',
        color: '#4a4a5a',
        label: 'Riverside Mall',
        description: 'Fluorescent lights. Shoppers. Fountain.'
    },
    mall_evening: {
        image: '../../shared_assets/images/mall_evening.png',
        color: '#3a3a4a',
        label: 'Riverside Mall - Evening',
        description: 'Stores closing. Janitor mops the floor.'
    },
    // Cafe
    cafe_morning: {
        image: '../../shared_assets/images/cafe_morning.png',
        color: '#4a2a1a',
        label: "Joe's Cafe - Morning",
        description: 'Fresh coffee. Sunlight through big windows.'
    },
    cafe_noon: {
        image: '../../shared_assets/images/cafe_noon.png',
        color: '#5a3a1a',
        label: "Joe's Cafe - Afternoon",
        description: 'Lunch rush. The hiss of the espresso machine.'
    },
    cafe_night: {
        image: '../../shared_assets/images/cafe_night.png',
        color: '#2a1a0a',
        label: "Joe's Cafe - Night",
        description: 'Pendant lamps. Rain on the windows.'
    },
    // Subway
    subway_morning: {
        image: '../../shared_assets/images/subway_morning.png',
        color: '#2a3a2a',
        label: 'Metro Subway - Morning',
        description: 'Commuters. A sax echoes down the tunnel.'
    },
    subway_night: {
        image: '../../shared_assets/images/subway_night.png',
        color: '#1a2a1a',
        label: 'Metro Subway - Night',
        description: 'Flickering lights. The train is late.'
    },
    // Downtown
    downtown_morning: {
        image: '../../shared_assets/images/downtown_morning.png',
        color: '#4a3a2a',
        label: 'Downtown - Morning',
        description: 'Yellow cabs. Steam from manholes.'
    },
    downtown_noon: {
        image: '../../shared_assets/images/downtown_noon.png',
        color: '#5a4a3a',
        label: 'Downtown - Afternoon',
        description: 'The city at full speed.'
    },
    downtown_night: {
        image: '../../shared_assets/images/downtown_night.png',
        color: '#1a0a2e',
        label: 'Downtown - Night',
        description: 'Neon reflections on wet pavement.'
    },
    // Pawn Shop
    pawnshop_interior: {
        image: '../../shared_assets/images/pawnshop_interior.png',
        color: '#3a2a1a',
        label: "Vinnie's Pawn",
        description: 'Cluttered shelves. The smell of old leather.'
    },
    // Brokerage
    brokerage_floor: {
        image: '../../shared_assets/images/brokerage_floor.png',
        color: '#1a2a1a',
        label: 'Bull & Bear Brokerage',
        description: 'Shouting traders. Green numbers scrolling.'
    },
    // Car Lot
    carlot_daytime: {
        image: '../../shared_assets/images/carlot_daytime.png',
        color: '#4a4a3a',
        label: "Crazy Eddie's Used Cars",
        description: 'Pennant banners. Chrome gleaming.'
    },
    // Real Estate
    realestate_office: {
        image: '../../shared_assets/images/realestate_office.png',
        color: '#3a2a2a',
        label: 'Chen & Associates Realty',
        description: 'Mahogany desk. Property photos on walls.'
    },
    // Nightclub
    nightclub_interior: {
        image: '../../shared_assets/images/nightclub_interior.png',
        color: '#2a0a3e',
        label: 'Club Neon',
        description: 'Bass thumping. Neon everything.'
    },
    // Restaurant
    restaurant_interior: {
        image: '../../shared_assets/images/restaurant_interior.png',
        color: '#3a1a1a',
        label: 'La Bella Vita',
        description: 'Candlelight. White tablecloths. Dean Martin.'
    },

    // Casino
    casino_interior: {
        image: '../../shared_assets/images/casino_interior.png',
        color: '#2a0a0a',
        label: 'The Golden Ace',
        description: 'Smoke. Neon. The sound of chips and broken dreams.'
    },
    casino_slots: {
        image: '../../shared_assets/images/casino_slots.png',
        color: '#3a0a1a',
        label: 'Slot Machines',
        description: 'Rows of blinking machines. Pull the lever.'
    },
    casino_blackjack: {
        image: '../../shared_assets/images/casino_blackjack.png',
        color: '#0a2a0a',
        label: 'Blackjack Table',
        description: 'Green felt. The dealer waits.'
    },
    casino_roulette: {
        image: '../../shared_assets/images/casino_roulette.png',
        color: '#2a0a0a',
        label: 'Roulette Wheel',
        description: 'The wheel spins. Red or black.'
    },
    casino_win: {
        image: '../../shared_assets/images/casino_win.png',
        color: '#3a2a0a',
        label: 'Winner!',
        description: 'Chips pile up. Tonight is your night.'
    },
    casino_lose: {
        image: '../../shared_assets/images/casino_lose.png',
        color: '#1a0a0a',
        label: 'The Golden Ace',
        description: 'Empty pockets. The house always wins.'
    },

    // === NPC INTERACTION SCENES ===
    vinnie_first_meeting: { image: '../../shared_assets/images/vinnie_first_meeting.png', color: '#3a2a1a', label: "Vinnie's Pawn", description: 'A gruff man eyes you from behind the counter.' },
    vinnie_showing_goods: { image: '../../shared_assets/images/vinnie_showing_goods.png', color: '#3a2a1a', label: "Vinnie's Pawn", description: 'Vinnie spreads his wares on the glass.' },
    vinnie_negotiating: { image: '../../shared_assets/images/vinnie_negotiating.png', color: '#2a1a0a', label: "Vinnie's Pawn", description: 'Vinnie leans in. This just got serious.' },
    vinnie_friendly: { image: '../../shared_assets/images/vinnie_friendly.png', color: '#4a3a1a', label: "Vinnie's Pawn", description: 'Vinnie\'s actually smiling. Coffee in hand.' },
    vinnie_conspiratorial: { image: '../../shared_assets/images/vinnie_conspiratorial.png', color: '#1a1a0a', label: "Vinnie's Pawn", description: 'Vinnie has something to tell you.' },

    diana_first_sighting: { image: '../../shared_assets/images/diana_first_sighting.png', color: '#5a3a1a', label: "Joe's Cafe", description: 'A woman sketches by the window. Cherry Coke.' },
    diana_first_conversation: { image: '../../shared_assets/images/diana_first_conversation.png', color: '#4a3a1a', label: "Joe's Cafe", description: 'She looks up, surprised.' },
    diana_coffee_date: { image: '../../shared_assets/images/diana_coffee_date.png', color: '#5a3a2a', label: "Joe's Cafe", description: 'Two people, two drinks, one connection.' },
    diana_park_walk: { image: '../../shared_assets/images/diana_park_walk.png', color: '#3a5a2a', label: 'Central Park', description: 'Walking together. Autumn leaves fall.' },
    diana_dinner_date: { image: '../../shared_assets/images/diana_dinner_date.png', color: '#3a1a1a', label: 'La Bella Vita', description: 'Candlelight. She looks radiant.' },
    diana_love_confession: { image: '../../shared_assets/images/diana_love_confession.png', color: '#1a1a3e', label: 'Central Park - Night', description: 'Under the lamp. Fireflies. Hearts open.' },
    diana_proposal: { image: '../../shared_assets/images/diana_proposal.png', color: '#3a1a1a', label: 'La Bella Vita', description: 'One knee. One ring. One question.' },
    diana_breakup: { image: '../../shared_assets/images/diana_breakup.png', color: '#2a2a3a', label: 'Your Apartment', description: 'She stands at the door. It\'s over.' },
    diana_win_ending: { image: '../../shared_assets/images/diana_win_ending.png', color: '#5a3a1a', label: 'Rooftop', description: 'Sunrise. Together.' },

    marcus_first_meeting: { image: '../../shared_assets/images/marcus_first_meeting.png', color: '#4a3a2a', label: "Joe's Cafe", description: 'Suspenders. Slicked hair. Espresso.' },
    marcus_brokerage_intro: { image: '../../shared_assets/images/marcus_brokerage_intro.png', color: '#1a2a1a', label: 'Bull & Bear', description: '"Welcome to my world."' },
    marcus_stock_tip: { image: '../../shared_assets/images/marcus_stock_tip.png', color: '#1a1a2a', label: 'Brokerage', description: 'Marcus leans in with insider knowledge.' },
    marcus_betrayal_reveal: { image: '../../shared_assets/images/marcus_betrayal_reveal.png', color: '#1a1a2a', label: 'Brokerage Office', description: 'Caught. Papers scatter.' },
    marcus_confession: { image: '../../shared_assets/images/marcus_confession.png', color: '#1a1a1a', label: 'Bar', description: 'Slumped. Defeated. Honest at last.' },

    ray_first_meeting: { image: '../../shared_assets/images/ray_first_meeting.png', color: '#2a3a1a', label: 'Central Park', description: 'Leather jacket. Toothpick. Watching.' },
    ray_pitching_deal: { image: '../../shared_assets/images/ray_pitching_deal.png', color: '#1a1a1a', label: 'The Park', description: 'Ray leans in close. Business.' },
    ray_deal_success: { image: '../../shared_assets/images/ray_deal_success.png', color: '#3a4a2a', label: 'Downtown', description: 'Cash in hand. Ray grins wide.' },
    ray_deal_failure: { image: '../../shared_assets/images/ray_deal_failure.png', color: '#2a2a3a', label: 'The Park', description: 'Hands up. "I\'m sorry, man."' },
    ray_family_crisis: { image: '../../shared_assets/images/ray_family_crisis.png', color: '#3a2a1a', label: 'Central Park', description: 'Ray on the bench. Head in hands.' },
    ray_grateful: { image: '../../shared_assets/images/ray_grateful.png', color: '#4a4a2a', label: 'The Park', description: 'Standing tall. A different man.' },

    chen_office_intro: { image: '../../shared_assets/images/chen_office_intro.png', color: '#3a2a2a', label: 'Chen & Associates', description: 'She evaluates you over her glasses.' },
    chen_showing_listings: { image: '../../shared_assets/images/chen_showing_listings.png', color: '#3a2a2a', label: 'Chen & Associates', description: 'Property sheets spread across mahogany.' },
    chen_closing_deal: { image: '../../shared_assets/images/chen_closing_deal.png', color: '#4a3a2a', label: 'Chen & Associates', description: 'SOLD. Handshake across the desk.' },
    chen_crown_jewel: { image: '../../shared_assets/images/chen_crown_jewel.png', color: '#4a3a1a', label: 'Chen & Associates', description: 'The special folder. Her eyes gleam.' },

    tony_nightclub_intro: { image: '../../shared_assets/images/tony_nightclub_intro.png', color: '#2a0a3e', label: 'Club Neon', description: 'Arms wide. Gold chains. Welcome.' },
    tony_vip_chat: { image: '../../shared_assets/images/tony_vip_chat.png', color: '#2a0a2e', label: 'Club Neon VIP', description: 'Velvet booth. Cocktails. Insider talk.' },
    tony_partnership_offer: { image: '../../shared_assets/images/tony_partnership_offer.png', color: '#2a1a1a', label: 'Back Office', description: 'Tony gets serious. Real business.' },
    tony_major_deal: { image: '../../shared_assets/images/tony_major_deal.png', color: '#1a0a1a', label: 'Back Office', description: 'One finger pointed. The stakes are real.' },
    tony_celebration: { image: '../../shared_assets/images/tony_celebration.png', color: '#3a1a4e', label: 'Club Neon VIP', description: 'Champagne. Neon rainbow. They did it.' },

    // === ACTIVITY SCENES ===
    activity_mall_buying: { image: '../../shared_assets/images/activity_mall_buying.png', color: '#4a4a5a', label: 'Secondhand Corner', description: 'Digging through the bins.' },
    activity_pawnshop_selling: { image: '../../shared_assets/images/activity_pawnshop_selling.png', color: '#3a2a1a', label: "Vinnie's Counter", description: 'The appraisal.' },
    activity_stock_trading: { image: '../../shared_assets/images/activity_stock_trading.png', color: '#0a1a0a', label: 'Trading Desk', description: 'Green numbers. Heart pounding.' },
    activity_buying_car: { image: '../../shared_assets/images/activity_buying_car.png', color: '#5a5a4a', label: 'Car Lot', description: 'Kicking the tires.' },
    activity_signing_papers: { image: '../../shared_assets/images/activity_signing_papers.png', color: '#3a2a2a', label: 'Signing', description: 'Pen meets paper. It\'s official.' },
    activity_cherry_coke: { image: '../../shared_assets/images/activity_cherry_coke.png', color: '#3a2a1a', label: 'Home', description: 'Cherry Coke. Boombox. Peace.' },
    activity_boombox: { image: '../../shared_assets/images/activity_boombox.png', color: '#3a2a1a', label: 'Home', description: 'Eyes closed. Music fills the room.' },
    activity_park_walk: { image: '../../shared_assets/images/activity_park_walk.png', color: '#2a4a1a', label: 'Central Park', description: 'Hands in pockets. Breathing.' },
    activity_food_court: { image: '../../shared_assets/images/activity_food_court.png', color: '#5a4a3a', label: 'Food Court', description: 'Burger, fries, people watching.' },
    activity_nightclub_dancing: { image: '../../shared_assets/images/activity_nightclub_dancing.png', color: '#2a0a3e', label: 'Dance Floor', description: 'Lights, bass, freedom.' },

    // === RANDOM EVENT SCENES ===
    event_found_wallet: { image: '../../shared_assets/images/event_found_wallet.png', color: '#2a4a1a', label: 'The Park', description: 'A wallet on the path.' },
    event_street_musician: { image: '../../shared_assets/images/event_street_musician.png', color: '#2a3a2a', label: 'Subway', description: 'Saxophone echoes through tile.' },
    event_mugging_attempt: { image: '../../shared_assets/images/event_mugging_attempt.png', color: '#1a0a0a', label: 'Downtown Alley', description: '"Empty your pockets."' },
    event_cherry_coke_sale: { image: '../../shared_assets/images/event_cherry_coke_sale.png', color: '#5a1a1a', label: 'Mall', description: 'Cherry Coke pyramid. SALE!' },

    // === SPECIAL SCENES ===
    special_title_screen: { image: '../../shared_assets/images/special_title_screen.png', color: '#1a0a2e', label: 'JUST A MAN', description: '' },
    special_day1_wakeup: { image: '../../shared_assets/images/special_day1_wakeup.png', color: '#2a2a1a', label: 'Morning', description: 'Alarm clock. 7:00 AM. A new start.' },
    special_act1_to_act2: { image: '../../shared_assets/images/special_act1_to_act2.png', color: '#0a1a2e', label: 'Your Window', description: 'City lights. Growing confidence.' },
    special_act2_to_act3: { image: '../../shared_assets/images/special_act2_to_act3.png', color: '#1a1a3e', label: 'The View', description: 'Higher now. The city at eye level.' },
    special_gameover_bankrupt: { image: '../../shared_assets/images/special_gameover_bankrupt.png', color: '#1a1a1a', label: 'Evicted', description: 'Empty room. Eviction notice.' },
    special_gameover_burnout: { image: '../../shared_assets/images/special_gameover_burnout.png', color: '#2a2a3a', label: 'Hospital', description: 'Beeping monitors. White walls.' },
    special_win_ending: { image: '../../shared_assets/images/special_win_ending.png', color: '#4a2a1a', label: 'Sunrise', description: 'You made it.' },
    special_credits_bg: { image: '../../shared_assets/images/special_credits_bg.png', color: '#2a1a0a', label: 'Memories', description: 'A life in Polaroids.' },
    special_narrator_intro: { image: '../../shared_assets/images/special_narrator_intro.png', color: '#0a0a0a', label: '', description: '' },
    special_montage_hustling: { image: '../../shared_assets/images/special_montage_hustling.png', color: '#2a2a2a', label: 'The Grind', description: 'Buy, sell, trade, count.' },

    // === UI/TRANSITION SCENES ===
    location_pawnshop_exterior: { image: '../../shared_assets/images/location_pawnshop_exterior.png', color: '#3a3a2a', label: "Vinnie's Pawn", description: 'Neon PAWN sign. Iron bars.' },
    location_nightclub_exterior: { image: '../../shared_assets/images/location_nightclub_exterior.png', color: '#1a0a2e', label: 'Club Neon', description: 'Velvet rope. Neon glow.' },
    location_brokerage_exterior: { image: '../../shared_assets/images/location_brokerage_exterior.png', color: '#3a3a4a', label: 'Bull & Bear', description: 'Glass and steel. Brass nameplate.' },
    event_ray_deal_handoff: { image: '../../shared_assets/images/event_ray_deal_handoff.png', color: '#0a0a0a', label: 'Back Alley', description: 'Quick exchange. Don\'t look.' },
};

// ============================================
// SCENE RESOLUTION
// ============================================

function getSceneForLocation(locationId, timeOfDay) {
    const upgraded = gameState && gameState.propertiesOwned && gameState.propertiesOwned.length > 0;

    const mapping = {
        home: {
            morning: upgraded ? 'home_upgraded_morning' : 'home_starter_morning',
            noon: upgraded ? 'home_upgraded_noon' : 'home_starter_noon',
            night: upgraded ? 'home_upgraded_night' : 'home_starter_night',
        },
        park: {
            morning: 'park_morning',
            noon: 'park_noon',
            night: 'park_night',
        },
        mall: {
            morning: 'mall_noon',
            noon: 'mall_noon',
            night: 'mall_evening',
        },
        cafe: {
            morning: 'cafe_morning',
            noon: 'cafe_noon',
            night: 'cafe_night',
        },
        subway: {
            morning: 'subway_morning',
            noon: 'subway_morning',
            night: 'subway_night',
        },
        downtown: {
            morning: 'downtown_morning',
            noon: 'downtown_noon',
            night: 'downtown_night',
        },
        pawnshop: {
            morning: 'pawnshop_interior',
            noon: 'pawnshop_interior',
            night: 'pawnshop_interior',
        },
        brokerage: {
            morning: 'brokerage_floor',
            noon: 'brokerage_floor',
            night: 'brokerage_floor',
        },
        carlot: {
            morning: 'carlot_daytime',
            noon: 'carlot_daytime',
            night: 'carlot_daytime',
        },
        realestate: {
            morning: 'realestate_office',
            noon: 'realestate_office',
            night: 'realestate_office',
        },
        nightclub: {
            morning: 'nightclub_interior',
            noon: 'nightclub_interior',
            night: 'nightclub_interior',
        },
        restaurant: {
            morning: 'restaurant_interior',
            noon: 'restaurant_interior',
            night: 'restaurant_interior',
        },
        casino: {
            morning: 'casino_interior',
            noon: 'casino_interior',
            night: 'casino_interior',
        },
    };

    const locMap = mapping[locationId];
    if (!locMap) return 'home_starter_morning';
    return locMap[timeOfDay] || Object.values(locMap)[0];
}

function getSceneData(sceneId) {
    return SCENES[sceneId] || { image: '', color: '#1a1a2e', label: 'Unknown', description: '' };
}
