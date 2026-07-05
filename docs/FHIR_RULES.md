# FHIR Rules

- Use HL7 FHIR DSTU3
- Create resources with Transaction Bundle
- Use POST
- New resources use fullUrl = urn:uuid:...
- Internal references use urn:uuid:...
- Existing resources use ResourceType/id
- Match resources using business identifiers, not server IDs.
