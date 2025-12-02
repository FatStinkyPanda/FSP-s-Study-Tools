/**
 * Voice Training Scripts
 *
 * Extensive training scripts for voice cloning with varying lengths,
 * topics, and phonetic coverage for optimal voice capture.
 */

export interface TrainingScript {
  id: string;
  title: string;
  category: 'short' | 'medium' | 'long' | 'extended';
  description: string;
  estimatedDuration: string; // e.g., "30s", "2m", "5m"
  text: string;
  tags: string[];
}

export interface ScriptCategory {
  id: string;
  name: string;
  description: string;
  scripts: TrainingScript[];
}

// Short scripts (15-30 seconds) - Good for quick tests
const shortScripts: TrainingScript[] = [
  {
    id: 'short-1',
    title: 'Quick Intro',
    category: 'short',
    description: 'A brief introduction covering common sounds',
    estimatedDuration: '15s',
    text: 'Hello, my name is your assistant. I am here to help you with any questions you may have. Feel free to ask me anything.',
    tags: ['intro', 'greeting', 'basic']
  },
  {
    id: 'short-2',
    title: 'Weather Report',
    category: 'short',
    description: 'Weather-style announcement with varied intonation',
    estimatedDuration: '20s',
    text: 'Today we can expect partly cloudy skies with temperatures reaching seventy-two degrees. There is a thirty percent chance of rain this evening, so you might want to bring an umbrella just in case.',
    tags: ['weather', 'numbers', 'announcement']
  },
  {
    id: 'short-3',
    title: 'Technology Overview',
    category: 'short',
    description: 'Technical terms and modern vocabulary',
    estimatedDuration: '25s',
    text: 'Artificial intelligence and machine learning are transforming how we interact with technology. From voice assistants to automated systems, these innovations are becoming an integral part of our daily lives.',
    tags: ['technology', 'modern', 'professional']
  },
  {
    id: 'short-4',
    title: 'Phonetic Warmup',
    category: 'short',
    description: 'Covers many English phonemes',
    estimatedDuration: '30s',
    text: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! The five boxing wizards jump quickly.',
    tags: ['phonetics', 'warmup', 'pangram']
  }
];

// Medium scripts (1-2 minutes) - Good balance of coverage and time
const mediumScripts: TrainingScript[] = [
  {
    id: 'medium-1',
    title: 'Educational Lecture',
    category: 'medium',
    description: 'Academic style with complex sentences',
    estimatedDuration: '1m 30s',
    text: `The study of history reveals patterns that help us understand our present and anticipate our future. Throughout the centuries, civilizations have risen and fallen, each leaving behind valuable lessons for subsequent generations.

Consider the ancient Egyptians, who built magnificent pyramids that still stand today as testaments to human ingenuity. Their understanding of mathematics, astronomy, and engineering was remarkably advanced for their time.

Similarly, the Greeks contributed philosophy, democracy, and scientific inquiry to human civilization. Thinkers like Socrates, Plato, and Aristotle laid the groundwork for Western philosophical thought that continues to influence us today.

By examining these historical examples, we gain perspective on our own challenges and achievements. History, in essence, serves as humanity's collective memory.`,
    tags: ['educational', 'history', 'academic', 'lecture']
  },
  {
    id: 'medium-2',
    title: 'Story Narration',
    category: 'medium',
    description: 'Narrative style with emotional range',
    estimatedDuration: '2m',
    text: `Once upon a time, in a small village nestled between rolling hills and a sparkling river, there lived a young girl named Emma. She had curious eyes that sparkled with wonder and a heart full of dreams.

Every morning, Emma would wake before sunrise to watch the mist dance across the meadow. She believed, with all her heart, that the mist was actually fairies performing their morning rituals.

One extraordinary day, as the first rays of sunlight pierced through the fog, Emma noticed something glimmering in the tall grass. She approached carefully, her heart beating with excitement.

There, hidden among the dewdrops and wildflowers, lay a small golden key. It was unlike anything she had ever seen, with intricate patterns carved into its surface that seemed to shift and change in the light.

Emma picked up the key and felt a warm sensation spread through her fingers. She knew, somehow, that this discovery would change her life forever. And so began her greatest adventure.`,
    tags: ['story', 'narrative', 'emotional', 'fantasy']
  },
  {
    id: 'medium-3',
    title: 'News Broadcast',
    category: 'medium',
    description: 'Professional news reading style',
    estimatedDuration: '1m 45s',
    text: `Good evening, and welcome to the evening news. Tonight, we bring you comprehensive coverage of the day's most significant events from around the world.

In economic news, markets showed strong gains today with the major indices reaching new highs. Analysts attribute this growth to positive employment data and increased consumer confidence.

Turning to international affairs, world leaders gathered in Geneva for the annual climate summit. Discussions focused on renewable energy initiatives and sustainable development goals for the coming decade.

In local news, the city council approved funding for a new community center that will serve residents of all ages. Construction is expected to begin next month and should be completed by the end of the year.

Stay tuned for weather updates and sports highlights coming up after the break. We'll be right back.`,
    tags: ['news', 'broadcast', 'professional', 'formal']
  },
  {
    id: 'medium-4',
    title: 'Science Explanation',
    category: 'medium',
    description: 'Scientific content with technical terms',
    estimatedDuration: '2m',
    text: `The human brain is perhaps the most complex organ in the known universe. Containing approximately eighty-six billion neurons, it processes information at incredible speeds while consuming only about twenty watts of power.

Each neuron connects to thousands of other neurons through synapses, creating a network of trillions of connections. These connections strengthen or weaken based on our experiences, a process known as neuroplasticity.

When you learn something new, your brain physically changes. New neural pathways form, existing ones strengthen, and unused connections gradually fade away. This remarkable adaptability continues throughout our entire lives.

Sleep plays a crucial role in this process. During sleep, the brain consolidates memories, removes toxins, and reorganizes neural connections. This is why adequate rest is essential for learning and cognitive function.

Understanding how the brain works not only satisfies our curiosity but also helps us develop better learning strategies and treatments for neurological conditions.`,
    tags: ['science', 'brain', 'educational', 'technical']
  }
];

// Long scripts (3-5 minutes) - Excellent for comprehensive voice capture
const longScripts: TrainingScript[] = [
  {
    id: 'long-1',
    title: 'Philosophy of Learning',
    category: 'long',
    description: 'Extended philosophical discussion',
    estimatedDuration: '4m',
    text: `The pursuit of knowledge has been a defining characteristic of human civilization since our earliest ancestors first looked up at the stars and wondered about their nature. This innate curiosity drives us to explore, question, and understand the world around us.

Education is not merely the accumulation of facts and figures. Rather, it is a transformative process that shapes how we think, perceive, and interact with reality. True learning changes us at a fundamental level, expanding our perspectives and opening doors to new possibilities.

Consider the ancient Greek concept of paideia, which encompassed not just intellectual education but the holistic development of a person's character and civic capabilities. The Greeks understood that knowledge divorced from wisdom and virtue is incomplete.

In modern times, we often emphasize specialization and technical skills. While these are undoubtedly valuable, we must not lose sight of the broader purpose of education. Critical thinking, ethical reasoning, and the ability to communicate effectively remain essential regardless of one's chosen field.

The process of learning itself is worthy of examination. We know that people learn in different ways. Some prefer visual information, while others learn best through hearing or hands-on experience. Understanding your own learning style can significantly enhance your educational journey.

Furthermore, the emotional component of learning cannot be overlooked. We remember experiences that evoke strong feelings far better than neutral ones. This is why passionate teachers often inspire lasting change in their students.

Technology has revolutionized access to information. Today, virtually anyone with an internet connection can access lectures from world-renowned universities, explore vast digital libraries, and connect with experts across the globe.

Yet this abundance of information presents its own challenges. We must develop skills to evaluate sources, distinguish fact from fiction, and synthesize diverse perspectives into coherent understanding.

Ultimately, learning is a lifelong journey. The most successful individuals are those who remain curious, humble enough to acknowledge what they don't know, and persistent in their pursuit of growth.`,
    tags: ['philosophy', 'education', 'extended', 'thoughtful']
  },
  {
    id: 'long-2',
    title: 'Technology and Society',
    category: 'long',
    description: 'Discussion of technological impact',
    estimatedDuration: '4m 30s',
    text: `Technology shapes our world in ways both obvious and subtle. From the smartphones in our pockets to the invisible algorithms that curate our digital experiences, technological systems permeate nearly every aspect of modern life.

The pace of technological change has accelerated dramatically over the past few decades. What once took generations to develop now emerges within years or even months. This rapid evolution brings tremendous opportunities but also significant challenges.

Consider artificial intelligence, a field that has progressed from science fiction to practical reality in a remarkably short time. AI systems now diagnose diseases, drive vehicles, translate languages, and create art. The implications for employment, creativity, and human identity are profound.

Yet technology is not deterministic. We make choices about how to develop, deploy, and regulate technological systems. These choices reflect our values and priorities as a society. The outcomes are not predetermined but emerge from countless decisions by engineers, policymakers, businesses, and individuals.

Privacy has become a pressing concern in the digital age. Our online activities generate vast amounts of data that companies collect, analyze, and monetize. The balance between convenience and privacy requires ongoing negotiation and thoughtful regulation.

Social media has transformed how we communicate, organize, and understand the world. These platforms enable connection across distances and give voice to previously marginalized perspectives. However, they also facilitate misinformation, polarization, and unhealthy comparison.

The environmental impact of technology is another critical consideration. Data centers consume enormous amounts of energy, and electronic waste poses significant disposal challenges. Sustainable technology development must become a priority.

Looking ahead, emerging technologies like quantum computing, gene editing, and brain-computer interfaces will raise new ethical questions. How we answer these questions will shape the future of human civilization.

Education must evolve to prepare people for this technological landscape. Beyond technical skills, we need ethical frameworks, critical thinking abilities, and the creativity to imagine beneficial applications.

The relationship between technology and society is reciprocal. Technology influences society, but society also shapes which technologies are developed and how they are used. By engaging thoughtfully with these dynamics, we can work toward outcomes that enhance human flourishing.`,
    tags: ['technology', 'society', 'AI', 'ethics', 'extended']
  },
  {
    id: 'long-3',
    title: 'Nature and Environment',
    category: 'long',
    description: 'Environmental awareness and natural world',
    estimatedDuration: '5m',
    text: `The natural world surrounds us with beauty, complexity, and wonder at every scale. From microscopic organisms to vast ecosystems spanning continents, nature operates through intricate patterns and relationships that have evolved over billions of years.

Consider a forest, which might appear at first glance to be simply a collection of trees. In reality, it is a dynamic community where countless species interact in ways both competitive and cooperative. Trees communicate through underground fungal networks, sharing nutrients and warning signals. Insects pollinate flowers while birds distribute seeds. Predators and prey maintain population balances through constant adaptation.

The oceans cover more than seventy percent of Earth's surface and contain ecosystems as diverse and complex as any on land. Coral reefs, often called the rainforests of the sea, support an astonishing variety of life despite occupying less than one percent of the ocean floor.

Weather patterns connect distant regions of the globe. A butterfly's wing in Brazil might not literally cause a tornado in Texas, but the principle captures something true about atmospheric interconnection. El Nino events in the Pacific influence rainfall patterns across multiple continents.

Human activities have become a dominant force shaping natural systems. Our agricultural practices, urban development, and industrial processes affect landscapes, water cycles, and atmospheric composition at unprecedented scales. Climate change represents perhaps the most significant of these impacts.

The loss of biodiversity is another pressing concern. Species extinction rates have accelerated dramatically, threatening the resilience and stability of ecosystems that provide essential services to human society. Clean water, pollination, soil formation, and climate regulation all depend on healthy, diverse natural systems.

Yet there is also reason for hope. Conservation efforts have successfully protected many species and habitats. Renewable energy technologies continue to improve and scale. Growing awareness of environmental issues inspires both individual action and policy change.

Indigenous communities around the world have long understood the importance of living in balance with nature. Their traditional ecological knowledge offers valuable insights for sustainable practices.

Restoring and protecting natural systems will require unprecedented cooperation across nations, sectors, and generations. The challenges are significant, but so is human capacity for innovation and collective action.

By fostering connection with nature and understanding our place within ecological systems, we can cultivate the values and motivations needed to meet these challenges. Every individual choice matters, and together we can shape a more sustainable future.`,
    tags: ['nature', 'environment', 'ecology', 'climate', 'extended']
  }
];

// Extended scripts (5+ minutes) - Maximum voice capture for highest quality
const extendedScripts: TrainingScript[] = [
  {
    id: 'extended-1',
    title: 'Complete Voice Training Session',
    category: 'extended',
    description: 'Comprehensive script covering all phonemes and emotional ranges',
    estimatedDuration: '8m',
    text: `Welcome to this comprehensive voice training session. Over the next several minutes, we will read together a variety of passages designed to capture the full range of your voice. Please speak naturally and clearly, maintaining a comfortable pace throughout.

Let us begin with some basic sentences that cover common sounds in the English language. The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump. Sphinx of black quartz, judge my vow.

Now let us practice some numbers and common expressions. The year two thousand twenty-four marks a significant milestone. Prices range from fifteen dollars to two hundred fifty dollars. Contact us at one eight hundred five five five one two three four. The meeting is scheduled for three forty-five in the afternoon.

Moving on to questions and exclamations. What time does the show begin? Where would you like to go for dinner? How wonderful that you could join us! I cannot believe how quickly the time has passed! Really, is that what you think? Absolutely, I completely agree with your assessment!

Let us explore some emotional variations. Speaking with enthusiasm: This is the most exciting news I have heard all year! Speaking calmly: Take a deep breath and relax. Everything will work out fine. Speaking seriously: We need to address this matter with appropriate gravity. Speaking warmly: It is so lovely to see you again after all this time.

Technical terminology often requires clear articulation. Photosynthesis converts carbon dioxide and water into glucose and oxygen. The mitochondria are the powerhouses of the cell. Electromagnetic radiation spans the spectrum from radio waves to gamma rays. Algorithms process data through sequential computational steps.

Literary passages help capture natural rhythm and expression. It was the best of times, it was the worst of times. To be or not to be, that is the question. All that glitters is not gold. A journey of a thousand miles begins with a single step.

Foreign words and names appear frequently in English speech. Thank you, merci, gracias, danke, and arigatou all express gratitude. Cities like Paris, Tokyo, Berlin, and Rio de Janeiro attract millions of visitors. Entrepreneurs, cuisine, fiancee, and rendezvous come from French origins.

Now some conversational dialogue patterns. Hello, how are you doing today? I am doing well, thank you for asking. Have you had a chance to review the documents? Yes, I looked them over this morning. What are your thoughts? I think we should proceed with option two.

Scientific concepts require precise pronunciation. Deoxyribonucleic acid, commonly known as DNA, carries genetic information. Quantum mechanics describes behavior at subatomic scales. Neuroplasticity refers to the brain's ability to reorganize itself. Photovoltaic cells convert sunlight directly into electricity.

Historical references add depth to any discussion. The Renaissance period witnessed remarkable artistic and scientific achievements. World War Two fundamentally reshaped international relations. The Industrial Revolution transformed economies and societies. Ancient civilizations left lasting legacies in architecture, law, and philosophy.

Medical terminology often challenges pronunciation. Cardiovascular disease affects the heart and blood vessels. Pharmaceutical interventions treat various conditions. Immunological responses protect against pathogens. Psychological wellbeing encompasses emotional and mental health.

Business and financial language pervades modern discourse. Quarterly earnings exceeded analyst expectations. Market capitalization reached unprecedented levels. Strategic partnerships drive innovation and growth. Sustainable practices benefit both profits and planet.

Geographical names span the globe. The Amazon River flows through South America. Mount Everest stands as Earth's highest peak. The Mediterranean Sea connects three continents. Antarctica remains the least populated continent.

In conclusion, this comprehensive training session has covered a wide range of phonetic, emotional, and contextual variations. Regular practice with such diverse material helps develop a natural, versatile speaking voice. Thank you for your dedication to this process.`,
    tags: ['comprehensive', 'training', 'phonetics', 'emotional', 'extended']
  },
  {
    id: 'extended-2',
    title: 'Storytelling Marathon',
    category: 'extended',
    description: 'Extended narrative with multiple characters and scenes',
    estimatedDuration: '10m',
    text: `The old lighthouse keeper, Thomas, had lived alone on the rocky promontory for thirty-seven years. His weathered face bore the marks of countless storms, and his eyes held the distant look of one who has spent a lifetime watching the horizon.

Every evening at precisely six o'clock, Thomas climbed the one hundred and forty-two steps to the lamp room. The ritual never varied: check the lenses, fill the oil reservoirs, wind the clockwork mechanism, and finally, light the flame that would guide ships safely through the treacherous waters.

On this particular autumn evening, as golden light painted the waves in shades of amber and rose, something unusual caught Thomas's attention. A small boat, no more than a fishing skiff, bobbed erratically about half a mile offshore. Even at this distance, he could see it was in trouble.

Without hesitation, Thomas descended the stairs faster than his aging joints appreciated. He pulled the tarp off his own boat and pushed it into the churning surf. Years of experience guided his movements as he navigated through the rocky shallows and out toward the distressed vessel.

As he drew closer, Thomas could see a young woman struggling with the oars. Her dark hair whipped wildly in the wind, and her face showed a mixture of determination and fear. The boat's hull had a significant crack, and water was steadily seeping in.

Throw me the rope, Thomas shouted over the roar of the wind. The woman looked up, startled but relieved, and complied. With practiced efficiency, Thomas secured the line and began towing her toward shore.

Once safely on the beach, the woman introduced herself. My name is Marina. I am a marine biologist studying the kelp forests in this area. I am afraid I underestimated the afternoon currents. Thank you so much for your help.

Thomas nodded gruffly but could not hide the curiosity in his eyes. What brings a scientist to these remote waters?

Marina explained that she was investigating unusual changes in the local ecosystem. Fish populations had shifted dramatically over the past few years, and she suspected it was connected to changes in ocean temperature and chemistry.

As they walked up the path to the lighthouse, Marina noticed the countless books lining the walls of Thomas's small living quarters. Most were about maritime history and navigation, but several shelves held works on natural science and ecology.

You are interested in the natural world, she observed.

Thomas shrugged. When you spend as much time alone as I do, books become your companions. The sea teaches you things, but books help you understand what the sea is saying.

Over cups of hot tea, the unlikely pair fell into deep conversation. Thomas shared decades of observations about the changing coastline, the migration patterns of birds, the behavior of whales passing by on their annual journeys. Marina listened intently, recognizing valuable data in his anecdotes.

In the following weeks, Marina returned often to the lighthouse. She set up monitoring equipment with Thomas's help and taught him to record scientific observations. In turn, he shared his intimate knowledge of the local waters, the hidden caves, the timing of tides, the signs of approaching storms.

Their collaboration attracted attention from the scientific community. Thomas, who had lived in isolation for so long, found himself at the center of a significant research project. Young researchers came to interview him, and his name appeared in academic papers.

But more important than the recognition was the friendship that developed. Marina became like the daughter Thomas never had, and he became the mentor she had always sought. Together, they worked to understand and protect the waters that had defined his life.

One clear night, as they stood in the lamp room watching the beam sweep across the darkness, Marina asked, Do you ever regret spending your life out here, away from everything?

Thomas considered the question carefully. Every life has its trade-offs. I missed certain experiences that most people take for granted. But I found meaning in this work, in keeping ships safe, in watching the eternal dance of waves and weather. And now, at the end of my days, I have found a new purpose in our work together.

Marina smiled and placed her hand on the old keeper's shoulder. The lighthouse beam continued its eternal rotation, casting its light across the dark waters, just as it had for generations, just as it would continue long after they were gone.

This is the magic of stories, Thomas continued. They connect us across time and space. The keepers who came before me, the sailors they guided, the scientists who will continue this research, we are all part of something larger than ourselves.

As the first stars emerged in the deepening sky, the lighthouse stood sentinel as it always had, a beacon of hope in the darkness, a symbol of human dedication to helping others find their way.`,
    tags: ['story', 'narrative', 'characters', 'emotional', 'extended', 'lighthouse']
  }
];

// Export organized script categories
export const scriptCategories: ScriptCategory[] = [
  {
    id: 'short',
    name: 'Quick Recordings',
    description: 'Short scripts perfect for quick voice samples (15-30 seconds)',
    scripts: shortScripts
  },
  {
    id: 'medium',
    name: 'Standard Training',
    description: 'Medium-length scripts for balanced voice capture (1-2 minutes)',
    scripts: mediumScripts
  },
  {
    id: 'long',
    name: 'Extended Training',
    description: 'Longer scripts for comprehensive voice modeling (3-5 minutes)',
    scripts: longScripts
  },
  {
    id: 'extended',
    name: 'Professional Sessions',
    description: 'Extended scripts for maximum voice quality (5+ minutes)',
    scripts: extendedScripts
  }
];

// Get all scripts as flat array
export function getAllScripts(): TrainingScript[] {
  return [...shortScripts, ...mediumScripts, ...longScripts, ...extendedScripts];
}

// Get script by ID
export function getScriptById(id: string): TrainingScript | undefined {
  return getAllScripts().find(script => script.id === id);
}

// Get scripts by category
export function getScriptsByCategory(category: TrainingScript['category']): TrainingScript[] {
  switch (category) {
    case 'short': return shortScripts;
    case 'medium': return mediumScripts;
    case 'long': return longScripts;
    case 'extended': return extendedScripts;
    default: return [];
  }
}

// Search scripts by tags
export function searchScriptsByTags(tags: string[]): TrainingScript[] {
  const lowerTags = tags.map(t => t.toLowerCase());
  return getAllScripts().filter(script =>
    script.tags.some(tag => lowerTags.includes(tag.toLowerCase()))
  );
}

export default {
  scriptCategories,
  getAllScripts,
  getScriptById,
  getScriptsByCategory,
  searchScriptsByTags
};
