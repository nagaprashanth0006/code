import unittest
from unittest.mock import patch
import app

class FlaskAppTestCase(unittest.TestCase):
    def setUp(self):
        self.app = app.app.test_client()
        self.app.testing = True

    @patch('random.random', return_value=0.5)  # Simulate success (no error)
    def test_service1_success(self, mock_random):
        response = self.app.get('/service1')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['service'], 'service1')
        self.assertIn('latency', data)
        self.assertIn('hostname', data)

    @patch('random.random', return_value=0.5)
    def test_service2_success(self, mock_random):
        response = self.app.get('/service2')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['service'], 'service2')

    @patch('random.random', return_value=0.5)
    def test_service3_success(self, mock_random):
        response = self.app.get('/service3')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['service'], 'service3')

    @patch('random.random', return_value=0.1)  # Simulate error (random < 0.2)
    def test_service1_error(self, mock_random):
        response = self.app.get('/service1')
        self.assertEqual(response.status_code, 500)
        data = response.get_json()
        self.assertEqual(data['status'], 'error')
        self.assertEqual(data['service'], 'service1')
        self.assertIn('hostname', data)

    def test_metrics_endpoint(self):
        response = self.app.get('/metrics')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'app_requests_total', response.data)
        self.assertIn(b'app_request_latency_seconds', response.data)
        self.assertEqual(response.content_type, 'text/plain; charset=utf-8')

if __name__ == '__main__':
    unittest.main()
