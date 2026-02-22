import time
from unittest.mock import patch, MagicMock
import pytest

def test_client_creates_session_with_headers():
    from http_client import TcdbClient
    client = TcdbClient()
    assert "User-Agent" in client.session.headers
    assert "Mozilla" in client.session.headers["User-Agent"]

def test_client_delays_between_requests():
    from http_client import TcdbClient
    client = TcdbClient(min_delay=0.1, max_delay=0.2)
    with patch.object(client.session, 'get') as mock_get:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        start = time.time()
        client.get("http://example.com/1")
        client.get("http://example.com/2")
        elapsed = time.time() - start
        assert elapsed >= 0.1  # At least one delay

def test_client_retries_on_server_error():
    from http_client import TcdbClient
    client = TcdbClient(min_delay=0, max_delay=0, retry_wait=0.01)
    with patch.object(client.session, 'get') as mock_get:
        error_resp = MagicMock()
        error_resp.status_code = 500
        error_resp.raise_for_status.side_effect = Exception("500 Server Error")
        ok_resp = MagicMock()
        ok_resp.status_code = 200
        ok_resp.raise_for_status = MagicMock()
        mock_get.side_effect = [error_resp, ok_resp]
        result = client.get("http://example.com/test")
        assert result.status_code == 200
        assert mock_get.call_count == 2

def test_client_raises_after_max_retries():
    from http_client import TcdbClient
    client = TcdbClient(min_delay=0, max_delay=0, retry_wait=0.01, max_retries=2)
    with patch.object(client.session, 'get') as mock_get:
        error_resp = MagicMock()
        error_resp.status_code = 503
        error_resp.raise_for_status.side_effect = Exception("503 Unavailable")
        mock_get.return_value = error_resp
        with pytest.raises(Exception, match="503"):
            client.get("http://example.com/test")
        assert mock_get.call_count == 3  # 1 initial + 2 retries
