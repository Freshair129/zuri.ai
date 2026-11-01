# Synthetic TLS identity

These PEM files are public test fixtures, including the test private key. They
authenticate no real service and must NEVER be used outside disposable tests.
The self-signed certificate covers loopback, smoke-core and the isolated fixture
Docker IPs. Production must supply its own narrowly trusted CA and IP SAN leaf.
