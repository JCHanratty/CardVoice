"""
Rate-limited HTTP client for TCDB scraping.
Uses cloudscraper to bypass Cloudflare challenges.
Adds random delays, retries, and realistic headers.
"""
import time
import random
import logging
import json
import os
import cloudscraper

logger = logging.getLogger(__name__)

# Path for persisting browser cookies between runs
_COOKIE_FILE = os.path.join(os.path.dirname(__file__), "cookies.json")


class TcdbClient:
    """HTTP client with rate limiting and retry logic for TCDB."""

    BASE_URL = "https://www.tcdb.com"

    def __init__(self, *, min_delay: float = 1.5, max_delay: float = 3.5,
                 retry_wait: float = 30.0, max_retries: int = 3,
                 timeout: float = 30.0):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.retry_wait = retry_wait
        self.max_retries = max_retries
        self.timeout = timeout
        self._last_request_time = 0.0

        self.session = cloudscraper.create_scraper()
        self._load_cookies()

    def _load_cookies(self):
        """Load saved cookies from disk if available."""
        if os.path.exists(_COOKIE_FILE):
            try:
                with open(_COOKIE_FILE, "r") as f:
                    cookies = json.load(f)
                for c in cookies:
                    self.session.cookies.set(c["name"], c["value"],
                                             domain=c.get("domain", ""),
                                             path=c.get("path", "/"))
                logger.info(f"Loaded {len(cookies)} cookies from {_COOKIE_FILE}")
            except Exception as e:
                logger.warning(f"Could not load cookies: {e}")

    def _save_cookies(self):
        """Persist current session cookies to disk."""
        cookies = []
        for c in self.session.cookies:
            cookies.append({
                "name": c.name, "value": c.value,
                "domain": c.domain, "path": c.path,
            })
        with open(_COOKIE_FILE, "w") as f:
            json.dump(cookies, f, indent=2)
        logger.debug(f"Saved {len(cookies)} cookies")

    def _wait_for_rate_limit(self):
        """Wait random delay between requests to appear human."""
        now = time.time()
        elapsed = now - self._last_request_time
        delay = random.uniform(self.min_delay, self.max_delay)
        if elapsed < delay:
            wait = delay - elapsed
            logger.debug(f"Rate limit: waiting {wait:.1f}s")
            time.sleep(wait)

    def get(self, url: str):
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
        """Login to TCDB. Returns True on success.

        TCDB's login page is behind Cloudflare's JS challenge which
        cloudscraper cannot solve. Instead, use import_browser_cookies()
        or manually place cookies.json next to this file.
        """
        logger.warning(
            "Direct login is blocked by Cloudflare. "
            "Use 'python migrator.py --import-cookies' to import cookies "
            "from your browser instead."
        )
        return False

    def is_logged_in(self) -> bool:
        """Check if current session has a valid login."""
        self._wait_for_rate_limit()
        self._last_request_time = time.time()
        resp = self.session.get(f"{self.BASE_URL}/MyProfile.cfm",
                                timeout=self.timeout, allow_redirects=False)
        # If logged in, MyProfile returns 200; if not, redirects to Login
        logged_in = resp.status_code == 200
        if logged_in:
            logger.info("Session is authenticated")
        else:
            logger.info("Session is NOT authenticated")
        return logged_in

    def import_browser_cookies(self, browser: str = "chrome") -> bool:
        """Import cookies from a local browser using browser_cookie3.

        Requires: pip install browser-cookie3
        User must be logged into tcdb.com in their browser.
        """
        try:
            import browser_cookie3
        except ImportError:
            logger.error(
                "browser_cookie3 not installed. Run: pip install browser-cookie3"
            )
            return False

        try:
            if browser == "chrome":
                cj = browser_cookie3.chrome(domain_name=".tcdb.com")
            elif browser == "firefox":
                cj = browser_cookie3.firefox(domain_name=".tcdb.com")
            elif browser == "edge":
                cj = browser_cookie3.edge(domain_name=".tcdb.com")
            else:
                logger.error(f"Unsupported browser: {browser}")
                return False

            count = 0
            for cookie in cj:
                self.session.cookies.set(cookie.name, cookie.value,
                                         domain=cookie.domain, path=cookie.path)
                count += 1

            if count == 0:
                logger.error("No TCDB cookies found. Are you logged in to tcdb.com in your browser?")
                return False

            self._save_cookies()
            logger.info(f"Imported {count} cookies from {browser}")

            # Verify the cookies work
            return self.is_logged_in()
        except Exception as e:
            logger.error(f"Failed to import cookies from {browser}: {e}")
            return False
