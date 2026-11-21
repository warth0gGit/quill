/**
 * Quill's hand-picked corrections for lazy typing: dropped apostrophes,
 * swapped letters and the misspellings people make most often.
 *
 * Each entry is "typed:meant", separated by spaces; "_" stands for a space
 * in the meant text ("alot:a_lot"). Keys are lower case. Capitals the
 * writer used are kept ("Teh" becomes "The"), and "I" is always a capital.
 */

const CONTRACTIONS = `
im:I'm ive:I've id:I'd ill:I'll
dont:don't doesnt:doesn't didnt:didn't cant:can't couldnt:couldn't wouldnt:wouldn't
shouldnt:shouldn't isnt:isn't wasnt:wasn't arent:aren't werent:weren't havent:haven't
hasnt:hasn't hadnt:hadn't wont:won't aint:ain't mustnt:mustn't neednt:needn't mightnt:mightn't
youre:you're youve:you've youll:you'll youd:you'd
theyre:they're theyve:they've theyll:they'll theyd:they'd
weve:we've wed:we'd
hes:he's shes:she's thats:that's whats:what's wheres:where's whos:who's
theres:there's heres:here's hows:how's whens:when's whys:why's
itll:it'll thatll:that'll therell:there'll wholl:who'll
wouldve:would've couldve:could've shouldve:should've mightve:might've mustve:must've
whatre:what're whatve:what've yall:y'all lets:let's

do'nt:don't does'nt:doesn't did'nt:didn't ca'nt:can't could'nt:couldn't would'nt:wouldn't
should'nt:shouldn't is'nt:isn't was'nt:wasn't are'nt:aren't have'nt:haven't
`;

// "lets" stays: "she lets me" is as common as "let's go".
const KEEP_AS_TYPED = new Set(["lets", "ill", "id", "wed", "hes", "shes", "were", "its", "well"]);

const TYPOS = `
teh:the hte:the tthe:the thw:the yhe:the tje:the rhe:the thr:the
adn:and nad:and anf:and amd:and abd:and
taht:that thta:that tath:that htat:that
waht:what wht:what whta:what
jsut:just juts:just
becuase:because becasue:because beacuse:because becuse:because becaus:because 
wiht:with wtih:with iwth:with wih:with
fo:of
yuo:you yoo:you yu:you uou:you
yoru:your yuor:your
thier:their theri:their
tehre:there ther:there thre:there
theyr:they're
hwo:how hw:how
woudl:would wuold:would owuld:would wouldnt've:wouldn't've
coudl:could cuold:could shoudl:should shuold:should
nto:not
ahve:have hvae:have hae:have
knwo:know konw:know kmow:know nkow:know
dosent:doesn't dosnt:doesn't
alot:a_lot
abotu:about baout:about abuot:about
agian:again agin:again
aslo:also
alwasy:always alwyas:always
anyting:anything anythign:anything
arond:around aroudn:around
befor:before bfore:before
beggining:beginning begining:beginning
beleive:believe belive:believe
bettter:better
cahnge:change chnage:change
cna:can
coem:come
comming:coming
definately:definitely definatly:definitely definitly:definitely defintely:definitely
diffrent:different differnt:different diferent:different
doign:doing
donig:doing
enought:enough enogh:enough
everyting:everything everythign:everything
evrey:every evry:every
exapmle:example exmaple:example
finaly:finally
freind:friend freinds:friends
fomr:from frmo:from
gonig:going giong:going goign:going
gerat:great graet:great
hapen:happen hapened:happened happend:happened
iwll:will wiil:will wil:will
knowlege:knowledge
liek:like lkie:like likr:like
littel:little litle:little
mkae:make amke:make maek:make
mabye:maybe maybee:maybe
mroe:more moer:more
mohter:mother
mysefl:myself
neccessary:necessary necessary:necessary neccesary:necessary necesary:necessary
nothign:nothing nothin:nothing
nwo:now
ocasion:occasion occassion:occasion
occured:occurred occuring:occurring occurence:occurrence
oen:one
ohter:other otehr:other
peopel:people poeple:people pepole:people peple:people
probaly:probably probly:probably 
realy:really relaly:really reallly:really
reccomend:recommend recomend:recommend
recieve:receive recieved:received reciept:receipt
rember:remember remeber:remember rememebr:remember
rigth:right rihgt:right
sayed:said siad:said
seperate:separate seperately:separately
shoudl:should
soemthing:something somethign:something somthing:something
someting:something
soem:some smoe:some
stil:still
sucess:success succesful:successful sucessful:successful
suprise:surprise suprised:surprised
tahn:than thna:than
tehm:them thme:them
tehn:then thne:then
tehy:they thye:they
thigns:things thign:thing thnig:thing
thnk:think thikn:think thnik:think htink:think
thsi:this tihs:this htis:this
thoguh:though 
thougth:thought
throught:through
tiem:time tmie:time
tommorow:tomorrow tomorow:tomorrow tommorrow:tomorrow
tongiht:tonight 
truely:truly
tyhe:the
udnerstand:understand understnad:understand
untill:until
usualy:usually
veyr:very vrey:very
wnat:want watn:want
whcih:which wich:which
whiel:while
wierd:weird theif:thief theives:thieves
ok:OK tv:TV uk:UK usa:USA pc:PC
wokr:work wrok:work
wriet:write wirte:write writting:writing writen:written
wether:whether
whereever:wherever
yaer:year yera:year
yesterady:yesterday
accomodate:accommodate acheive:achieve accross:across adress:address
agressive:aggressive apparantly:apparently appearence:appearance arguement:argument
basicly:basically beautifull:beautiful beatiful:beautiful buisness:business busness:business
calender:calendar catagory:category cemetary:cemetery collegue:colleague comittee:committee
completly:completely concious:conscious curiousity:curiosity dissapear:disappear
dissapoint:disappoint dilemna:dilemma embarass:embarrass enviroment:environment
excercise:exercise existance:existence experiance:experience familar:familiar
fourty:forty foward:forward futher:further goverment:government grammer:grammar
gaurd:guard happyness:happiness harrass:harass heighth:height heirarchy:hierarchy
humourous:humorous ignorence:ignorance immediatly:immediately independant:independent
interupt:interrupt irrelevent:irrelevant knowlegde:knowledge
libary:library lisence:license maintainance:maintenance millenium:millennium
mischievious:mischievous misspel:misspell neice:niece noticable:noticeable
occassionally:occasionally ommit:omit oppurtunity:opportunity orignal:original
paralel:parallel particurlar:particular pasttime:pastime persistant:persistent
posession:possession prefered:preferred presense:presence privelege:privilege
publically:publicly questionaire:questionnaire recieving:receiving refered:referred
relevent:relevant religous:religious remeberance:remembrance resistence:resistance
restaraunt:restaurant rythm:rhythm scedule:schedule sentance:sentence sieze:seize
similiar:similar sincerly:sincerely speach:speech strenght:strength succesfully:successfully
supercede:supersede tatoo:tattoo tendancy:tendency therefor:therefore threshhold:threshold
tounge:tongue tradgedy:tragedy truley:truly twelth:twelfth tyrany:tyranny
unforseen:unforeseen unfortunatly:unfortunately unneccessary:unnecessary vaccum:vacuum
vegtable:vegetable visable:visible wierdly:weirdly writeing:writing
anywya:anyway anwyay:anyway
ofthe:of_the inthe:in_the tothe:to_the onthe:on_the andthe:and_the forthe:for_the
`;

function parse(src: string, into: Map<string, string>) {
  for (const pair of src.split(/\s+/)) {
    const i = pair.indexOf(":");
    if (i < 1) continue;
    const typed = pair.slice(0, i);
    const meant = pair.slice(i + 1).replace(/_/g, " ");
    if (typed !== meant.toLowerCase() || typed !== meant) into.set(typed, meant);
  }
}

/** typed word (lower case, straight apostrophes) -> what was meant */
export const FIXES = new Map<string, string>();
parse(CONTRACTIONS, FIXES);
parse(TYPOS, FIXES);
for (const w of KEEP_AS_TYPED) FIXES.delete(w);
// Entries that only differ from the typed word by being identical are dropped above.
for (const [k, v] of FIXES) if (k === v) FIXES.delete(k);

/** Words after which a full stop doesn't end the sentence. */
export const ABBREVIATIONS = new Set(
  "mr mrs ms dr st prof sr jr vs etc eg ie e.g i.e cf al approx dept est inc ltd co no vol fig ch p pp ca jan feb mar apr jun jul aug sep sept oct nov dec mon tue tues wed thu thur thurs fri sat sun".split(
    " ",
  ),
);
