"""
Rate-limited HTTP client for TCDB scraping.
Adds random delays, retries, and realistic headers.
"""
import time
import random
import logging
import requests

logger = logging.getLogger(__name__)

# Realistic browser User-Agent
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


class TcdbClient:
    """HTTP client with rate limiting and retry logic for TCDB."""

    BASE_URL = "https://www.tcdb.com"

    def __init__(self, *, min_delay: float = 3.0, max_delay: float = 8.0,
                 retry_wait: float = 30.0, max_retries: int = 3,
                 timeout: float = 30.0):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.retry_wait = retry_wait
        self.max_retries = max_retries
        self.timeout = timeout
        self._last_request_time = 0.0

        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        })

    def _wait_for_rate_limit(self):
        """Wait random delay between requests to appear human."""
        now = time.time()
        elapsed = now - self._last_request_time
        delay = random.uniform(self.min_delay, self.max_delay)
        if elapsed < delay:
            wait = delay - elapsed
            logger.debug(f"Rate limit: waiting {wait:.1f}s")
            time.sleep(wait)

    def get(self, url: str) -> requests.Response:
        """GET with rate limiting and retry."""
        self._wait_for_rate_limit()

        last_error = None
        for attempt in range(1 + self.max_retries):
            resp = None
            try:
                self._last_request_time = time.time()
                resp = self.session.get(url, timeout=self.timeout)
                resp.raise_for_status()
                return resp
            except Exception as e:
                last_error = e
                status = getattr(resp, 'status_code', None)
                logger.warning(f"Request failed (attempt {attempt + 1}/{1 + self.max_retries}): "
                               f"{url} -- {e}")
                if attempt < self.max_retries:
                    wait = self.retry_wait
                    if status in (403, 429):
                        wait = 60.0 if self.retry_wait > 1 else self.retry_wait
                    logger.info(f"Retrying in {wait:.0f}s...")
                    time.sleep(wait)

        raise last_error

    def login(self, username: str, password: str) -> bool:
        """Login to TCDB. Returns True on success."""
        # First GET the login page to pick up session cookies
        self._wait_for_rate_limit()
        self._last_request_time = time.time()
        self.session.get(f"{self.BASE_URL}/Login.cfm", timeout=self.timeout)

        self._wait_for_rate_limit()
        self._last_request_time = time.time()
        resp = self.session.post(
            f"{self.BASE_URL}/Login.cfm",
            data={"username": username, "password": password},
            timeout=self.timeout,
            allow_redirects=True
        )

        # Check if login succeeded by looking for signs of being logged in
        logged_in = "Logout" in resp.text or "MyProfile" in resp.text or "My Profile" in resp.text
        if logged_in:
            logger.info("Login successful")
        else:
            logger.error("Login failed -- check credentials")
        return logged_in
