"""
CardVoice Voice Engine
Uses faster-whisper for local speech recognition, optimized for card numbers.
Streams audio from mic, processes chunks, returns parsed card numbers.
"""
import numpy as np
import queue
import threading
import time
import re
from typing import Callable, Optional, List, Tuple


# Word-to-number mapping (covers speech recognition quirks)
WORD_TO_NUM = {
    # Basic digits
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
    'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
    # Common misheard
    'won': 1, 'wan': 1, 'wun': 1,
    'to': 2, 'too': 2, 'tu': 2, 'tew': 2,
    'tree': 3, 'free': 3,
    'for': 4, 'fore': 4, 'fo': 4,
    'fife': 5,
    'sick': 6, 'sicks': 6,
    'ate': 8,
    'nein': 9,
    # Teens
    'ten': 10, 'tin': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13,
    'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
    'eighteen': 18, 'nineteen': 19,
    # Tens
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fourty': 40,
    'fifty': 50, 'fitty': 50,
    'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
    # Hundred as standalone (e.g. "a hundred" → 100)
    'hundred': 100,
}

# Multiplier words
MULT_WORDS = {'times', 'x', 'of', 'count', 'quantity', 'qty', 'stock', 'copies', 'copy', 'ex'}

# Skip words
SKIP_WORDS = {
    'and', 'the', 'a', 'an', 'um', 'uh', 'like', 'okay', 'ok',
    'card', 'number', 'hash', 'pound', 'next', 'then', 'also',
    'have', 'got', 'need', 'want', 'is', 'are', 'it', 'that',
    'this', 'so', 'yeah', 'yes', 'no', 'not', 'with', 'from',
}


def parse_spoken_numbers(text: str) -> List[int]:
    """
    Parse spoken text into a list of card numbers.
    
    Handles:
    - Direct digits: "42 55 103"
    - Spoken words: "forty two fifty five one hundred three"
    - Duplicates: "42 times 3" → [42, 42, 42]
    - Mixed: "42 42 55" → [42, 42, 55] (42 counted twice)
    - Removes dashes/hyphens that cause negative numbers
    
    Returns list of integers, preserving duplicates for quantity counting.
    """
    if not text:
        return []
    
    # Clean input
    text = text.lower().strip()
    text = re.sub(r'[-–—]', ' ', text)  # Remove all dashes
    text = re.sub(r'[,.!?;:]', ' ', text)  # Remove punctuation
    text = re.sub(r'\s+', ' ', text)  # Normalize whitespace
    
    tokens = text.split()
    results = []
    i = 0
    last_number = None
    
    while i < len(tokens):
        token = tokens[i]
        
        # Skip filler words
        if token in SKIP_WORDS:
            i += 1
            continue
        
        # Handle "times N" / "x N" multiplier
        if token in MULT_WORDS and last_number is not None:
            if i + 1 < len(tokens):
                mult = _parse_single_number(tokens[i + 1])
                if mult is not None and 1 <= mult <= 50:
                    # Add (mult - 1) more copies (one already added)
                    for _ in range(mult - 1):
                        results.append(last_number)
                    i += 2
                    continue
            i += 1
            continue
        
        # Try to parse a compound number starting at position i
        number, consumed = _parse_compound_number(tokens, i)
        
        if number is not None and 1 <= number <= 9999:
            results.append(number)
            last_number = number
            i += consumed
        else:
            # Try as raw digits in the token
            digits = re.findall(r'\d+', token)
            if digits:
                for d in digits:
                    v = int(d)
                    if 1 <= v <= 9999:
                        results.append(v)
                        last_number = v
            i += 1
    
    return results


def _parse_single_number(token: str) -> Optional[int]:
    """Parse a single token as a number."""
    if token in WORD_TO_NUM:
        return WORD_TO_NUM[token]
    try:
        return int(token)
    except ValueError:
        return None


def _parse_compound_number(tokens: List[str], start: int) -> Tuple[Optional[int], int]:
    """
    Parse a compound spoken number starting at position `start`.
    Returns (number, tokens_consumed) or (None, 0).
    
    Handles: "one hundred twenty three", "fifty five", "three", "42", etc.
    """
    if start >= len(tokens):
        return None, 0
    
    token = tokens[start]
    
    # Check if it's already a digit string
    if re.match(r'^\d+$', token):
        return int(token), 1
    
    # Check for simple word number
    if token not in WORD_TO_NUM:
        return None, 0
    
    value = WORD_TO_NUM[token]
    consumed = 1
    
    # Check for "hundred" pattern: "three hundred forty two"
    if 1 <= value <= 9 and start + 1 < len(tokens) and tokens[start + 1] == 'hundred':
        value *= 100
        consumed = 2
        
        # Check for remaining tens/ones after hundred (skip "and" if present)
        if start + consumed < len(tokens) and tokens[start + consumed] == 'and':
            consumed += 1
        if start + consumed < len(tokens):
            next_token = tokens[start + consumed]
            next_val = _parse_single_number(next_token)
            if next_val is not None:
                if 1 <= next_val <= 19:
                    value += next_val
                    consumed += 1
                elif 20 <= next_val <= 90:
                    value += next_val
                    consumed += 1
                    # Check for ones after tens: "hundred twenty THREE"
                    if start + consumed < len(tokens):
                        ones_token = tokens[start + consumed]
                        ones_val = _parse_single_number(ones_token)
                        if ones_val is not None and 1 <= ones_val <= 9:
                            value += ones_val
                            consumed += 1
        return value, consumed

    # Check for compound tens: "twenty three"
    if 20 <= value <= 90:
        if start + 1 < len(tokens):
            next_token = tokens[start + 1]
            next_val = _parse_single_number(next_token)
            if next_val is not None and 1 <= next_val <= 9:
                value += next_val
                consumed = 2
        return value, consumed
    
    # Simple single number
    return value, consumed


def parse_card_quantities(text: str) -> List[Tuple[int, int, float]]:
    """
    Parse text for explicit `card <id> Q <qty>` pairs with quantity tokens.

    Returns list of tuples: (card_id, qty, confidence)
    Confidence is a 0.0-1.0 float indicating parser certainty.
    
    Quantity tokens (high confidence = 0.98):
      - 'q', 'que', 'cue' → normalized to 'q'
      - 'qty', 'quantity', 'count'
      - 'x', 'times'
      
    Examples handled:
      - "card 55 q 20" → (55, 20, 0.98)
      - "card 55 que 20" → (55, 20, 0.98) 
      - "card 55 qty 20" → (55, 20, 0.98)
      - "card 55 x 3" → (55, 3, 0.98)
      - "card 55 20" → (55, 20, 0.70) [fallback]
      - "card 55" → (55, 1, 0.85) [default qty to 1]
      - "card 55q20" → (55, 20, 0.95) [attached tokens]
    """
    if not text:
        return []

    # Quantity token variants (normalized)
    QTY_TOKENS = {'q', 'que', 'cue', 'qty', 'quantity', 'count', 'x', 'times'}

    s = text.lower()
    s = re.sub(r'[,.!?;:]', ' ', s)
    s = re.sub(r'[-–—]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()

    # Split on the keyword 'card' (keep only segments that follow it)
    parts = [p.strip() for p in re.split(r'\bcard\b', s) if p.strip()]
    pairs = []

    for part in parts:
        tokens = part.split()
        if not tokens:
            continue

        card_id = None
        qty = None
        confidence = 0.0
        explicit_qty_token = False

        # Find first numeric/word number in tokens for card id
        i = 0
        token_remainder = None  # To track remaining part of current token
        
        while i < len(tokens):
            token = tokens[i]
            num, consumed = _parse_compound_number(tokens, i)
            if num is not None:
                card_id = num
                i += consumed
                break
            # try raw digits
            m = re.match(r"^(\d+)$", token)
            if m:
                card_id = int(m.group(1))
                i += 1
                break
            # Try to extract leading digits from token (e.g., "27q9" -> 27, remainder="q9")
            m_leading = re.match(r'^(\d+)(.*)$', token)
            if m_leading:
                card_id = int(m_leading.group(1))
                token_remainder = m_leading.group(2) if m_leading.group(2) else None
                i += 1
                break
            i += 1

        if card_id is None:
            continue

        # After card id: check for explicit quantity token or qty value
        qty_found_in_token = False
        
        # First check if remainder of previous token contains qty token+value (e.g., "q9" from "27q9")
        if token_remainder:
            for kw in QTY_TOKENS:
                if token_remainder.startswith(kw):
                    qty_keyword = kw
                    qty_remainder = token_remainder[len(kw):]
                    explicit_qty_token = True
                    if qty_remainder and re.match(r'^\d+', qty_remainder):
                        m = re.match(r'^(\d+)', qty_remainder)
                        if m:
                            qty = int(m.group(1))
                            qty_found_in_token = True
                    break
        
        # If not found in token remainder, search further tokens
        if not qty_found_in_token:
            while i < len(tokens):
                token = tokens[i]
                
                # Skip filler words
                if token in SKIP_WORDS:
                    i += 1
                    continue
                
                # Check if token starts with a quantity keyword (handle attached like "q9" or "qty20")
                qty_keyword = None
                qty_remainder = None
                for kw in QTY_TOKENS:
                    if token.startswith(kw):
                        qty_keyword = kw
                        qty_remainder = token[len(kw):]
                        break
                
                if qty_keyword:
                    explicit_qty_token = True
                    # Try to extract number from remainder or next token
                    if qty_remainder and re.match(r'^\d+', qty_remainder):
                        # Number attached to token like "q9"
                        m = re.match(r'^(\d+)', qty_remainder)
                        if m:
                            qty = int(m.group(1))
                            i += 1
                            break
                    elif i + 1 < len(tokens):
                        # Number in next token
                        num, consumed = _parse_compound_number(tokens, i + 1)
                        if num is not None:
                            qty = num
                            i += 1 + consumed
                            break
                        m = re.match(r"^(\d+)", tokens[i + 1])
                        if m:
                            qty = int(m.group(1))
                            i += 2
                            break
                    i += 1
                    continue
                
                # Check if token itself looks like a qty token attached to a number (e.g., "9q" or "20qty")
                # Extract any leading digits
                m_leading = re.match(r'^(\d+)([a-z]+)', token)
                if m_leading:
                    leading_num = int(m_leading.group(1))
                    trailing_letters = m_leading.group(2)
                    if trailing_letters in QTY_TOKENS:
                        # This is a number followed by qty token, treat as fallback positional
                        qty = leading_num
                        confidence = 0.70  # Lower confidence for attached tokens
                        i += 1
                        break
                
                # If no explicit token found, treat this as positional qty (lower confidence)
                num, consumed = _parse_compound_number(tokens, i)
                if num is not None:
                    qty = num
                    i += consumed
                    break
                m = re.match(r"^(\d+)$", token)
                if m:
                    qty = int(m.group(1))
                    i += 1
                    break
                i += 1

        # Compute confidence and default qty to 1 if not found
        if card_id is not None:
            if qty is None:
                # No explicit quantity found -> default to 1
                qty = 1
                confidence = 0.85
            elif explicit_qty_token:
                # Explicit quantity token found -> high confidence
                confidence = 0.98
            else:
                # Fallback positional parse -> lower confidence
                confidence = 0.70

            # Sanity checks
            if qty < 0:
                qty = abs(qty)
            if qty == 0:
                # zero quantity probably means mis-recognition -> lower confidence
                confidence = min(confidence, 0.5)

            pairs.append((card_id, qty, confidence))

    return pairs


def count_cards(numbers: List[int]) -> dict:
    """
    Count occurrences of each card number.
    Returns dict of {card_number: quantity}.
    """
    counts = {}
    for n in numbers:
        counts[n] = counts.get(n, 0) + 1
    return counts


def format_output(numbers: List[int]) -> str:
    """Format parsed numbers into the 'Have:' output string."""
    counts = count_cards(numbers)
    sorted_nums = sorted(counts.keys())
    parts = []
    for n in sorted_nums:
        if counts[n] > 1:
            parts.append(f"{n} x{counts[n]}")
        else:
            parts.append(str(n))
    return "Have: " + ", ".join(parts)


class VoiceEngine:
    """
    Real-time voice capture and transcription engine.
    Uses faster-whisper for local speech-to-text.
    """
    
    def __init__(self, model_size: str = "base", device: str = "cpu"):
        """
        Initialize voice engine.
        
        Args:
            model_size: Whisper model size ('tiny', 'base', 'small', 'medium')
                       'tiny' = fastest, least accurate
                       'base' = good balance for numbers
                       'small' = better accuracy, slower
            device: 'cpu' or 'cuda'
        """
        self.model_size = model_size
        self.device = device
        self.model = None
        self.is_recording = False
        self.audio_queue = queue.Queue()
        self.sample_rate = 16000
        self.chunk_duration = 3.0  # seconds per chunk
        self.all_numbers = []
        self._on_numbers = None
        self._on_status = None
        self._record_thread = None
        self._process_thread = None
    
    def load_model(self):
        """Load the Whisper model. Call once at startup."""
        from faster_whisper import WhisperModel
        self.model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type="int8"  # Fast CPU inference
        )
        return True
    
    def start(self, on_numbers: Callable = None, on_status: Callable = None):
        """
        Start recording and processing.
        
        Args:
            on_numbers: Callback(numbers: List[int], text: str) called with each batch
            on_status: Callback(status: str) for UI updates
        """
        import sounddevice as sd
        
        if self.is_recording:
            return
        
        self._on_numbers = on_numbers
        self._on_status = on_status
        self.is_recording = True
        
        # Start audio capture thread
        self._record_thread = threading.Thread(target=self._capture_audio, daemon=True)
        self._record_thread.start()
        
        # Start processing thread
        self._process_thread = threading.Thread(target=self._process_loop, daemon=True)
        self._process_thread.start()
        
        if self._on_status:
            self._on_status("recording")
    
    def stop(self):
        """Stop recording."""
        self.is_recording = False
        if self._on_status:
            self._on_status("stopped")
    
    def clear(self):
        """Clear all accumulated numbers."""
        self.all_numbers = []
    
    def get_results(self) -> dict:
        """Get current results."""
        return {
            "numbers": self.all_numbers,
            "counts": count_cards(self.all_numbers),
            "output": format_output(self.all_numbers),
            "unique": len(set(self.all_numbers)),
            "total": len(self.all_numbers),
        }
    
    def _capture_audio(self):
        """Capture audio from microphone in chunks."""
        import sounddevice as sd
        
        chunk_samples = int(self.sample_rate * self.chunk_duration)
        
        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype='float32',
                blocksize=chunk_samples,
                callback=self._audio_callback
            ):
                while self.is_recording:
                    time.sleep(0.1)
        except Exception as e:
            if self._on_status:
                self._on_status(f"error: {str(e)}")
    
    def _audio_callback(self, indata, frames, time_info, status):
        """Called for each audio chunk from sounddevice."""
        if self.is_recording:
            self.audio_queue.put(indata.copy())
    
    def _process_loop(self):
        """Process audio chunks through Whisper."""
        audio_buffer = np.array([], dtype=np.float32)
        min_samples = int(self.sample_rate * 1.5)  # Min 1.5 seconds before processing
        
        while self.is_recording:
            try:
                chunk = self.audio_queue.get(timeout=0.5)
                audio_buffer = np.append(audio_buffer, chunk.flatten())
                
                # Process when we have enough audio
                if len(audio_buffer) >= min_samples:
                    # Check if there's actual speech (energy threshold)
                    energy = np.sqrt(np.mean(audio_buffer ** 2))
                    if energy > 0.01:  # Adjustable threshold
                        self._transcribe_chunk(audio_buffer)
                    
                    audio_buffer = np.array([], dtype=np.float32)
                    
            except queue.Empty:
                # Process remaining buffer if it has content
                if len(audio_buffer) > self.sample_rate * 0.5:
                    energy = np.sqrt(np.mean(audio_buffer ** 2))
                    if energy > 0.01:
                        self._transcribe_chunk(audio_buffer)
                    audio_buffer = np.array([], dtype=np.float32)
    
    def _transcribe_chunk(self, audio: np.ndarray):
        """Transcribe an audio chunk and extract card numbers."""
        if self.model is None:
            return
        
        try:
            segments, info = self.model.transcribe(
                audio,
                language="en",
                initial_prompt=(
                    "Card numbers being spoken: "
                    "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 42, 45, "
                    "50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 120, 130, 140, 150, "
                    "175, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800, 900. "
                    "count 5, count 10, count 3, times 2. "
                    "one, two, three, four, five, six, seven, eight, nine, ten, "
                    "twenty, thirty, forty, fifty, sixty, seventy, eighty, ninety, hundred."
                ),
                word_timestamps=False,
                beam_size=3,
                temperature=0.0,
                vad_filter=True,
                vad_parameters=dict(
                    min_speech_duration_ms=100,
                    min_silence_duration_ms=300,
                    speech_pad_ms=200,
                ),
            )
            
            text = " ".join(seg.text for seg in segments).strip()
            
            if text:
                numbers = parse_spoken_numbers(text)
                if numbers:
                    self.all_numbers.extend(numbers)
                    if self._on_numbers:
                        self._on_numbers(numbers, text)
        
        except Exception as e:
            if self._on_status:
                self._on_status(f"transcribe_error: {str(e)}")
