const WORDS = `
about above actor admit adopt after again agree ahead alarm album alert alike alive allow alone along alter among angle angry
apart apple apply arena argue arise armor array aside asset avoid awake award aware badly baker basic basis beach began begin
being below bench black blame blank blast bleed blend bless blind block blood board boost booth bound brain brand brave bread
break breed brick bride brief bring broad broke brown brush build bunch burst buyer cabin cable candy carry carve catch cause
chain chair chalk charm chase cheap check cheek cheer chess chest chief child chill choir chose civil claim class clean clear
clerk click cliff climb clock close cloth cloud coach coast color comic coral couch could count court cover crack craft crane
crash crawl crazy cream crime cross crowd crown cruel crush curve cycle daily dance death delay depth dirty doubt dozen draft
drain drama dream dress drift drink drive eager early earth eight elbow elite empty enemy enjoy enter equal error essay event
every exact exist extra faint fairy faith false fancy fault feast fence fever fewer field fight final flame flash fleet float
flood floor flour fluid focus force forge forth forty found frame fresh front frost fruit funny giant glass globe glove grace
grade grain grand grant grape grass great green greet grief group guard guess guest guide habit happy harsh heart heavy hello
honey honor horse hotel house human humor ideal image index inner input irony issue jelly jewel joint judge juice knife knock
known label labor large laser later laugh layer learn lease least leave legal lemon level light limit linen liver lobby local
logic loose lucky lunch magic major maker march match maybe mayor meant medal media melon merry metal meter might minor minus
model money month moral motor mount mouse mouth movie music nasty naval nerve never newly night noble noise north novel nurse
ocean offer often olive onion opera orbit order other ought outer owner paint panel paper party pasta patch pause peace pearl
phase phone photo piano piece pilot pitch pizza place plain plane plant plate plaza point polar pound power press price pride
prime print prize proof proud prove pulse punch pupil queen quick quiet quite quote radio raise range rapid ratio reach react
ready realm rebel refer relax reply rider ridge rifle right rigid risky river roast robot rocky rough round route royal rural
salad sauce scale scene scope score sense serve seven shade shake shall shape share sharp sheep sheet shelf shell shift shine
shirt shock shoot shore short shout sight silly since sixth skill sleep slice slide small smart smile smoke snake solid solve
sorry sound south space spare speak speed spell spend spice spike spoon sport spray squad stack staff stage stair stamp stand
start state steam steel steep stick still stock stone store storm story stove strip study stuff style sugar suite sunny super
sweet swing sword table taste teach tenth thank their theme there thick thing think third those three throw thumb tiger tight
timer title toast today tooth topic total touch tough towel tower trace track trade trail train treat trend trial tribe trick
truck truly trust truth twice uncle under union unity until upper upset urban usage usual valid value video virus visit vital
vocal voice waste watch water weigh weird wheel where which while white whole whose width woman world worry worse worth would
wound write wrong yield young youth zebra
`
  .split(/\s+/)
  .filter((w) => /^[a-z]{5}$/.test(w)); // safety check: only real 5-letter words

module.exports = { WORDS };
