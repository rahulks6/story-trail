# Trusted CA certificates

`rds-ap-south-1-bundle.pem` is Amazon RDS's regional trust bundle for Asia Pacific (Mumbai). It
holds the three root CAs (RSA2048 G1, RSA4096 G1 and ECC384 G1) that sign RDS server
certificates there. With it the API verifies the database it connects to:

```sh
PGSSLMODE=verify-full PGSSLROOTCERT=/app/certs/rds-ap-south-1-bundle.pem
```

psql (migrations, scripts) reads the same variables.

- Source: https://truststore.pki.rds.amazonaws.com/ap-south-1/ap-south-1-bundle.pem (fetched 6 October 2026)
- sha256: `ca4a9dc14e06c3f84274eff3ffed0e5d4d3463141593e1159eb4a0904df6cd74`
- Valid until 2061 (RSA2048 G1) and 2121 (RSA4096 G1, ECC384 G1).

Deploying to another region needs that region's bundle, or the global bundle
(`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`). These are public CA
certificates, not secrets.
