import base64
import unittest
from unittest import mock

from app import search


SAMPLE_HTML = """<html><body>
<li class="b_algo">
  <h2><a href="https://example.org/award">Best Paper Award 2023</a></h2>
  <p>2023&ensp;Some snippet text about the award.</p>
</li>
<li class="b_algo">
  <h2><a href="https://example.org/paper">Another Result</a></h2>
  <p>Another snippet.</p>
</li>
</body></html>"""


class SearchWebTests(unittest.TestCase):
    def test_parses_bing_results(self):
        resp = mock.MagicMock()
        resp.text = SAMPLE_HTML
        resp.raise_for_status.return_value = None
        with mock.patch.object(search.httpx, "get", return_value=resp):
            results = search.search_web("query", max_results=5)

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].title, "Best Paper Award 2023")
        self.assertEqual(results[0].url, "https://example.org/award")
        self.assertIn("snippet", results[0].snippet)

    def test_resolves_bing_redirect_url(self):
        target = "https://example.org/target"
        encoded = base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")
        href = f"https://www.bing.com/ck/a?u=a1{encoded}.xyz"
        self.assertEqual(search._resolve_bing_url(href), target)

    def test_unknown_provider_raises(self):
        with mock.patch.dict(search.os.environ, {"WEB_SEARCH_PROVIDER": "nope"}):
            with self.assertRaises(ValueError):
                search.search_web("query")


if __name__ == "__main__":
    unittest.main()
