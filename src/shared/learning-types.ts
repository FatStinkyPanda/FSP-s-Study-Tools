// Learning Retention Techniques Types

export type TechniqueCategory = 'core' | 'emerging' | 'user-implementable';
export type TechniqueType = 'program' | 'user' | 'hybrid';

export interface LearningTechnique {
  id: string;
  name: string;
  description: string;
  category: TechniqueCategory;
  type: TechniqueType;
  enabled: boolean;
  researchBasis?: string;
  implementation?: string;
  guidance?: string;
}

// Core Program-Integrated Techniques
export const CORE_TECHNIQUES: LearningTechnique[] = [
  {
    id: 'retrieval-practice',
    name: 'Retrieval Practice',
    description: 'Active recall through flashcards and practice questions instead of passive re-reading',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Testing effect - retrieving information strengthens memory more than restudying',
    implementation: 'Auto-generated practice questions, flashcard reviews, self-testing prompts',
  },
  {
    id: 'spaced-repetition',
    name: 'Spaced Repetition',
    description: 'SM-2 algorithm with expanding review intervals based on performance',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Spacing effect - distributed practice is more effective than massed practice',
    implementation: 'Automatic scheduling of reviews based on forgetting curves',
  },
  {
    id: 'interleaving',
    name: 'Interleaving',
    description: 'Automatic mixing of topics for discrimination learning instead of blocked practice',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Mixed practice improves ability to distinguish between concepts',
    implementation: 'Session mixing, topic interleaving in practice tests',
  },
  {
    id: 'feynman-technique',
    name: 'Teaching Simulation (Feynman)',
    description: 'Jasper acts as a student for explanation practice - explain concepts simply',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Teaching others deepens understanding and reveals knowledge gaps',
    implementation: 'Jasper asks clarifying questions as a naive student',
  },
  {
    id: 'elaborative-interrogation',
    name: 'Elaborative Interrogation',
    description: '"Why" and "how" prompts for deep processing of material',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Asking why facts are true improves comprehension and retention',
    implementation: 'Automatic generation of why/how questions after content',
  },
  {
    id: 'dual-coding',
    name: 'Dual Coding',
    description: 'Automatic diagram and visual generation from text content',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Combining verbal and visual information strengthens memory',
    implementation: 'AI-generated diagrams, concept maps, visual summaries',
  },
  {
    id: 'generative-learning',
    name: 'Generative Learning',
    description: 'Prompts for user-created summaries, examples, and explanations',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Creating your own examples promotes deeper understanding',
    implementation: 'Prompts for summarization, example creation, analogy making',
  },
  {
    id: 'desirable-difficulties',
    name: 'Desirable Difficulties',
    description: 'Variable font rendering, delayed feedback for enhanced encoding',
    category: 'core',
    type: 'program',
    enabled: false, // Off by default as it can be disruptive
    researchBasis: 'Slight difficulties in processing improve long-term retention',
    implementation: 'Variable typography, strategic delays before feedback',
  },
  {
    id: 'successive-relearning',
    name: 'Successive Relearning',
    description: 'Mastery-based spaced repetition until criterion is met',
    category: 'core',
    type: 'program',
    enabled: true,
    researchBasis: 'Combining testing with spaced repetition optimizes learning',
    implementation: 'Repeat reviews until accuracy threshold reached',
  },
];

// Emerging Program Techniques
export const EMERGING_TECHNIQUES: LearningTechnique[] = [
  {
    id: 'curiosity-priming',
    name: 'Curiosity Priming',
    description: 'Intriguing questions or puzzles before content delivery to enhance attention',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Pre-session curiosity triggers, mystery questions',
  },
  {
    id: 'virtual-context',
    name: 'Virtual Context Environments',
    description: 'Distinct visual themes per subject for context-dependent memory',
    category: 'emerging',
    type: 'program',
    enabled: false,
    implementation: 'Subject-specific color schemes, backgrounds, and UI themes',
  },
  {
    id: 'emotional-anchoring',
    name: 'Emotional Anchoring',
    description: 'Narrative framing and stakes creation for emotional engagement',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Story-based scenarios, gamified stakes and consequences',
  },
  {
    id: 'predictive-error',
    name: 'Predictive Error Maximization',
    description: 'Presenting common misconceptions before correct answers',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Misconception exposure followed by resolution',
  },
  {
    id: 'adversarial-learning',
    name: 'Adversarial Learning',
    description: 'Debate mode with Jasper - argue against positions to strengthen understanding',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Jasper plays devil\'s advocate, challenges user positions',
  },
  {
    id: 'autobiographical-embedding',
    name: 'Autobiographical Embedding',
    description: 'Character-based learning narratives connecting content to personal experience',
    category: 'emerging',
    type: 'program',
    enabled: false,
    implementation: 'Personalized story elements, character creation',
  },
  {
    id: 'anticipatory-priming',
    name: 'Anticipatory Priming',
    description: 'Pre-session hints and puzzles to prepare the mind for learning',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Topic preview, conceptual pre-exposure',
  },
  {
    id: 'counterfactual-elaboration',
    name: 'Counterfactual Elaboration',
    description: '"What if this were false?" reasoning prompts for deeper analysis',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Alternative scenario exploration, consequence analysis',
  },
  {
    id: 'memory-competition',
    name: 'Memory Competition',
    description: 'Similar item discrimination training to reduce interference',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Confusable item practice, discrimination tasks',
  },
  {
    id: 'failure-first',
    name: 'Failure-First Learning',
    description: 'Pre-tests before instruction to enhance subsequent learning',
    category: 'emerging',
    type: 'program',
    enabled: true,
    implementation: 'Pre-testing, productive failure scenarios',
  },
  {
    id: 'rhythmic-encoding',
    name: 'Rhythmic Encoding',
    description: 'Content restructured with rhythmic patterns for enhanced memory',
    category: 'emerging',
    type: 'program',
    enabled: false,
    implementation: 'Mnemonic rhythms, paced presentation',
  },
];

// User-Implementable Techniques
export const USER_TECHNIQUES: LearningTechnique[] = [
  {
    id: 'embodied-cognition',
    name: 'Embodied Cognition and Gesture',
    description: 'Physical movements and gestures during learning',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Create gestures for key concepts. Walk while reviewing. Use hand movements to "encode" abstract ideas.',
  },
  {
    id: 'olfactory-context',
    name: 'Olfactory Context Libraries',
    description: 'Scent-based memory associations for different subjects',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Assign specific scents to subjects. Use the same scent during study and recall. Create an "olfactory index" of your knowledge.',
  },
  {
    id: 'proprioceptive-encoding',
    name: 'Proprioceptive Context Encoding',
    description: 'Body position associations for different material',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Study different subjects in different positions (sitting, standing, lying). Maintain consistency for recall.',
  },
  {
    id: 'micro-stress',
    name: 'Micro-Stress Inoculation',
    description: 'Brief controlled stress to enhance memory consolidation',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Brief cold exposure, breath holds, or mild discomfort before study sessions. Keep it short (1-2 minutes).',
  },
  {
    id: 'interoceptive-matching',
    name: 'Interoceptive State Matching',
    description: 'Matching internal body states during study and recall',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Note your internal state (caffeine level, hunger, alertness) during study. Try to match it during exams.',
  },
  {
    id: 'cross-modal-translation',
    name: 'Cross-Modal Translation Chains',
    description: 'Converting information between different sensory modes',
    category: 'user-implementable',
    type: 'hybrid',
    enabled: false,
    guidance: 'Read text → speak it → draw it → act it out. Each translation strengthens memory.',
  },
  {
    id: 'exercise-timing',
    name: 'Exercise Timing',
    description: 'Physical exercise before or after learning sessions',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Light exercise 20-30 minutes before learning. More intense exercise 1-2 hours after for consolidation.',
  },
  {
    id: 'handwriting-encoding',
    name: 'Handwriting for Encoding',
    description: 'Writing notes by hand for better retention',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Take initial notes by hand. The motor act of writing strengthens memory traces.',
  },
  {
    id: 'temporal-landmarks',
    name: 'Temporal Landmark Manufacturing',
    description: 'Creating memorable events around study sessions',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Create unusual but not disruptive events around study (new location, small ceremony, unique setup).',
  },
  {
    id: 'micro-nap-interleaving',
    name: 'Micro-Nap Interleaving',
    description: 'Brief rest periods between study blocks for consolidation',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: '10-20 minute quiet rest periods between major topics. Eyes closed, wakeful rest.',
  },
  {
    id: 'sleep-optimization',
    name: 'Sleep Optimization',
    description: 'Quality sleep for memory consolidation',
    category: 'user-implementable',
    type: 'user',
    enabled: false,
    guidance: 'Prioritize 7-9 hours of sleep. Avoid heavy study right before bed. Review lightly before sleep.',
  },
];

// Full-Stack Learning Protocol
export interface LearningProtocol {
  id: string;
  name: string;
  phases: ProtocolPhase[];
}

export interface ProtocolPhase {
  name: string;
  timing: 'before' | 'during' | 'after' | 'over-time';
  techniques: Array<{
    techniqueId: string;
    type: 'program' | 'user' | 'hybrid';
    notes?: string;
  }>;
}

export const FULL_STACK_PROTOCOL: LearningProtocol = {
  id: 'full-stack',
  name: 'Full-Stack Learning Protocol',
  phases: [
    {
      name: 'Before Session',
      timing: 'before',
      techniques: [
        { techniqueId: 'curiosity-priming', type: 'program', notes: 'Curiosity-priming fragments' },
        { techniqueId: 'temporal-landmarks', type: 'user', notes: 'Temporal landmark creation' },
        { techniqueId: 'micro-stress', type: 'user', notes: 'Micro-stress inoculation' },
        { techniqueId: 'exercise-timing', type: 'user', notes: 'Light exercise' },
      ],
    },
    {
      name: 'During Session',
      timing: 'during',
      techniques: [
        { techniqueId: 'failure-first', type: 'program', notes: 'Failure-first testing' },
        { techniqueId: 'adversarial-learning', type: 'program', notes: 'Adversarial processing' },
        { techniqueId: 'olfactory-context', type: 'user', notes: 'Olfactory/proprioceptive context' },
        { techniqueId: 'feynman-technique', type: 'program', notes: 'Jasper technique application' },
      ],
    },
    {
      name: 'After Session',
      timing: 'after',
      techniques: [
        { techniqueId: 'exercise-timing', type: 'user', notes: 'Exercise for consolidation' },
        { techniqueId: 'cross-modal-translation', type: 'hybrid', notes: 'Cross-modal translation' },
        { techniqueId: 'counterfactual-elaboration', type: 'program', notes: 'Counterfactual elaboration' },
      ],
    },
    {
      name: 'Over Time',
      timing: 'over-time',
      techniques: [
        { techniqueId: 'successive-relearning', type: 'program', notes: 'Successive relearning with spaced intervals' },
        { techniqueId: 'memory-competition', type: 'program', notes: 'Memory competition tests' },
        { techniqueId: 'adversarial-learning', type: 'program', notes: 'Periodic adversarial review' },
      ],
    },
  ],
};

// Technique Settings
export interface TechniqueSettings {
  enabledTechniques: string[];
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced';
  sessionDuration: number; // minutes
  breakInterval: number; // minutes
  useProtocol: boolean;
  protocolId?: string;
}

export const DEFAULT_TECHNIQUE_SETTINGS: TechniqueSettings = {
  enabledTechniques: [
    'retrieval-practice',
    'spaced-repetition',
    'interleaving',
    'feynman-technique',
    'elaborative-interrogation',
    'dual-coding',
    'generative-learning',
    'successive-relearning',
    'curiosity-priming',
    'emotional-anchoring',
    'predictive-error',
    'adversarial-learning',
    'anticipatory-priming',
    'counterfactual-elaboration',
    'memory-competition',
    'failure-first',
  ],
  difficultyLevel: 'intermediate',
  sessionDuration: 45,
  breakInterval: 15,
  useProtocol: true,
  protocolId: 'full-stack',
};

// Get all techniques
export function getAllTechniques(): LearningTechnique[] {
  return [...CORE_TECHNIQUES, ...EMERGING_TECHNIQUES, ...USER_TECHNIQUES];
}

// Get techniques by category
export function getTechniquesByCategory(category: TechniqueCategory): LearningTechnique[] {
  return getAllTechniques().filter(t => t.category === category);
}

// Get techniques by type
export function getTechniquesByType(type: TechniqueType): LearningTechnique[] {
  return getAllTechniques().filter(t => t.type === type);
}

// Get technique by ID
export function getTechniqueById(id: string): LearningTechnique | undefined {
  return getAllTechniques().find(t => t.id === id);
}
