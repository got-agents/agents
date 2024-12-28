class ClarificationRequest {
    intent "request_more_information"
    message string
}

class CreateIssue {
    intent "create_issue"
    issue CreateIssueRequest
}

class ListTeams {
    intent "list_teams"
}

class ListIssues {
    
    intent "list_issues" @description("List issues from a given time range")
    from_time string
    to_time string
}

class ListUsers {
    intent "list_users" @description("list users on a team, or all users if no team_id is provided")
    team_id string?
}

class DoneForNow {
    intent "done_for_now"
    message string
}

class ListLabels {
    intent "list_labels" @description("list labels on a team, or all labels if no team_id is provided")
    team_id string?
}

class Label {
    id string
    name string
}

class HumanResponse {
    event_type "human_response"
    message string
}

class CreateIssueRequest {
    title string
    description string
    team_id string
    // labels_ids string[] @description("ids of labels to apply to the issue - must have at least one label")
    priority int? @description(#"
        The priority of the issue. 
        0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.
  "#)
}

class Issue {
    id string?
    title string
    description string
    team_id string
    url string
    labels Label[]
    priority string
    state string
}

class EmailMessage {
    from_address string
    to_address string[]
    cc_address string[]
    subject string
    content string
    datetime string
}

class EmailPayload {
    from_address string
    to_address string 
    subject string
    body string
    message_id string
    previous_thread EmailMessage[]
    raw_email string
    is_test bool?
}

class Event {
    type "email_received" | "human_response" | "issue_create_result" | "list_teams_result" | "list_issues_result" | "request_more_information" | "create_issue" | "done_for_now" | "list_teams" | "list_users" | "list_issues" | "list_users_result" | "list_labels" | "list_labels_result" | "error"
    data EmailPayload | HumanResponse | ClarificationRequest | CreateIssue | ListTeams | ListIssues | ListUsers | ListLabels | DoneForNow | string // escape hatch for untyped data from linear client
}


class Thread {
    initial_email EmailPayload
    events Event[]
}


function DetermineNextStep(
    thread: string // to keep this clean, make the client turn the thread into a prompt-ready string, didn't wanna solve that in jinja (although long term that's probably the best solution)
) -> ClarificationRequest | CreateIssue | ListTeams | ListIssues | ListUsers | DoneForNow {
    client CustomGPT4o
    prompt #"
        {{ _.role("system") }}

        You are a helpful assistant that helps the user with their linear issue management.

        {{ _.role("user") }}

        You are working on the following thread:

        {{ thread }}


        What should the next step be?

        {{ ctx.output_format }}
    "#
}

test InitialEmail {

  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <email_received>: 
                  {"from_address":"test@example.com","to_address":"support@company.com","subject":"New Ticket","body":"Can you make a new issue for Austin to restock the fridges with tasty beers?","message_id":"test123","previous_thread":[],"raw_email":"raw email content","is_test":null}
              </email_received>
              
          
    "#
  }
}


test TeamIDErrorAsksForMoreInput {
  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <email_received>:
                  {"from_address":"test@example.com","to_address":"support@company.com","subject":"New Ticket","body":"Can you make a new issue for Austin to restock the fridges with tasty beers?","message_id":"test123","previous_thread":[],"raw_email":"raw email content","is_test":null}
              </email_received>
              
      <create_issue> 
                  Title: Restock fridges with tasty beers
                  Description: Austin is requested to restock the fridges with tasty beers.
                  Team ID: team_supply_maintenance
              </create_issue>
              
      <issue_create_result>: 
                  {"errors": [{"message": "Argument Validation Error", "path": ["issueCreate"], "locations": [{"line": 3, "column": 13}], "extensions": {"code": "INVALID_INPUT", "type": "invalid input", "userError": true, "userPresentableMessage": "teamId must be a UUID.", "meta": {}}}], "data: null}"
              </issue_create_result>
              
          
    "#
  }
  @@assert({{this.intent == "list_teams"}})
}


test CompletedIssueCreate {
  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <email_received>
                  {"from_address":"test@example.com","to_address":"support@company.com","subject":"New Ticket","body":"Can you make a new issue for Austin to restock the fridges with tasty beers?","message_id":"test123","previous_thread":[],"raw_email":"raw email content","is_test":null}
              </email_received>
              
      <create_issue>
                  Title: Restock fridges with tasty beers
                  Description: Austin is requested to restock the fridges with tasty beers.
                  Team ID: team_supply_maintenance
      </create_issue>
              
      <issue_create_result>
                  {"errors": [{"message": "Argument Validation Error", "path": ["issueCreate"], "locations": [{"line": 3, "column": 13}], "extensions": {"code": "INVALID_INPUT", "type": "invalid input", "userError": true, "userPresentableMessage": "teamId must be a UUID.", "meta": {}}}], "data": null}
      </issue_create_result>
              
      <request_more_information>
                  {"intent":"request_more_information","message":"The team ID provided (team_supply_maintenance) is not a valid UUID, which caused the issue creation to fail. Please provide a valid UUID for the team."}
              </request_more_information>
              
      <human_response>
                  Message: use a different team id, perhaps try running list-teams?
      </human_response>
              
      <list_teams>
                  {"intent":"list_teams","teams":[]}
              </list_teams>
              
      <list_teams_result>
                  {"data": {"teams": {"nodes": [{"id": "fc0b4a10-9248-41f9-9566-0e5ad0b70a18", "name": "humanlayer-paulo", "members": {"nodes": [{"email": "dexter@querytale.com", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}, {"id": "af81035d-7c32-478d-b6f2-469a56f2b5cb", "name": "TempoLabs / HumanLayer", "members": {"nodes": [{"email": "elberthcorniell@gmail.com", "id": "a278a07f-9888-4937-b190-6064d43ff9de", "displayName": "elberthcorniell"}, {"email": "robinsingh1918@gmail.com", "id": "5ec0cbf9-3297-45e1-b758-02ef6e6db05f", "displayName": "robinsingh1918"}, {"email": "nicole@tempolabs.ai", "id": "b13ff369-0369-45da-8425-f7935f46a050", "displayName": "nicole"}, {"email": "hello@moona.design", "id": "e364329b-0a9a-4986-a932-8084ecc69031", "displayName": "matt"}, {"email": "dexter@querytale.com", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}, {"id": "b406e630-b082-4e43-ad23-8cf92c3082eb", "name": "Design", "members": {"nodes": [{"email": "hello@moona.design", "id": "e364329b-0a9a-4986-a932-8084ecc69031", "displayName": "matt"}, {"email": "dexter@querytale.com", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}, {"id": "ef53625f-bcc7-4776-a6a6-d86d4fcf27d9", "name": "Sales", "members": {"nodes": [{"email": "dexter@querytale.com", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}, {"id": "84041a81-78ea-496a-849c-36bcde13a37f", "name": "Marketing", "members": {"nodes": [{"email": "dexter@querytale.com", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}, {"id": "6b3b2115-efd4-4b83-8463-8160842d2c84", "name": "Engineering", "members": {"nodes": [{"email": "dexter@querytale.com", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}, {"id": "b1af0caf-0a15-4d27-a71a-7076f71948bf", "name": "Operations", "members": {"nodes": [{"email": "austin@austinalter.com", "id": "d9b7a650-e5f3-48d7-ba25-fe72a505cdf1", "displayName": "austin"}, {"email": "dexter@querytale.com", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}]}}}
      </list_teams_result>
              
      <create_issue>
                  Title: Restock fridges with tasty beers
                  Description: Austin is requested to restock the fridges with tasty beers.
                  Team ID: b1af0caf-0a15-4d27-a71a-7076f71948bf
      </create_issue>
              
      <issue_create_result>
                  {"data": {"issueCreate": {"success": true, "issue": {"id": "bd1c1df8-1399-49be-b96c-b175db42ab1e", "title": "Restock fridges with tasty beers", "description": "Austin is requested to restock the fridges with tasty beers."}}}}
      </issue_create_result>
              
          
    "#
  }
  @@assert({{this.intent == "done_for_now"}})
}


test Adequatechimpanzee {
  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <email_received>
                  {"from_address":"Dexter Horthy <dexter@humanlayer.dev>","to_address":"awake-pika@reply.humanlayer.dev","subject":"Re: new ticket","body":"Can you make this?","message_id":"<m56ze7kj.7b0b12a7-08eb-4aaa-ace5-bae8077b2f83@we.are.superhuman.com>","previous_thread":[{"from_address":"dexter@humanlayer.dev","to_address":["awake-pika@reply.humanlayer.dev"],"cc_address":[],"subject":"Create an engineering ticket with high priority","content":"Create an engineering ticket with high priority and labels bug,security to undo this recent terraform change, reinstating the more strict and complex dmarc policy\n\n# aws_route53_record.humanlayer_dev_dmarc_gsuite will be updated in-place\n ~ resource \"aws_route53_record\" \"humanlayer_dev_dmarc_gsuite\" {\n id = \"Z018843525F5RGLOMXMCE__dmarc.humanlayer.dev_TXT\"\n name = \" _dmarc. humanlayer. dev ( http://_dmarc.humanlayer.dev/ ) \"\n ~ records = [\n - \"v=DMARC1; p=quarantine; sp=reject; rua= mailto:dmarc-reports@metalytics. dev ( dmarc-reports@metalytics.dev ) ; ruf= mailto:dmarc-reports@ metalytics. dev ( dmarc-reports@metalytics.dev ) ; pct=100; aspf=s; adkim=s\",\n + \"v=DMARC1; p=none; rua= mailto:dmarc-reports@ metalytics. dev ( dmarc-reports@metalytics.dev ) \",\n ]\n # (5 unchanged attributes hidden)\n }","datetime":"Fri, 27 Dec 2024 08:32:00 -0800 (PST)"}],"raw_email":"Return-Path: <dexter@humanlayer.dev>\r\nReceived: from mail-vs1-f46.google.com (mail-vs1-f46.google.com [209.85.217.46])\r\n by inbound-smtp.us-east-2.amazonaws.com with SMTP id lpc0fn5gqb6k2i1s1rc55g6nvgeracvooa2hi9o1\r\n for awake-pika@reply.humanlayer.dev;\r\n Fri, 27 Dec 2024 16:43:13 +0000 (UTC)\r\nX-SES-Spam-Verdict: PASS\r\nX-SES-Virus-Verdict: PASS\r\nReceived-SPF: pass (spfCheck: domain of humanlayer.dev designates 209.85.217.46 as permitted sender) client-ip=209.85.217.46; envelope-from=dexter@humanlayer.dev; helo=mail-vs1-f46.google.com;\r\nAuthentication-Results: amazonses.com;\r\n spf=pass (spfCheck: domain of humanlayer.dev designates 209.85.217.46 as permitted sender) client-ip=209.85.217.46; envelope-from=dexter@humanlayer.dev; helo=mail-vs1-f46.google.com;\r\n dkim=pass header.i=@humanlayer.dev;\r\n dmarc=pass header.from=humanlayer.dev;\r\nX-SES-RECEIPT: AEFBQUFBQUFBQUFHTURnQkZ2UGkrY2JPQnZyS0ZiamxhOXB5MzlYcGUvd1p3S0lHc0hpSHNvK2dCZHhQUUFVTGlGWmpnWUZrZEkxdG5yT2ExY0lUTW5vY2tBbzVXdFVSSzQwdDc1eWtZMGg1TDQ0NHBDR0dxWGZST0ZsNzVYb1Z1MnBJYWYzMytlRGlLUEZ5bVN6bkhsa2ZLMloxdGsrUFZGV04xaUw3RW1saWNWZyt1dTlNVlpXWGNSOFIxUVdJSGc2TlI2MG9wWUV2TG00TE80bUFvRVJOQ2VvT2E3YXgydVkrand1RUxKSU1pNkppT2ZkZElEMllJOWJrb2MxSDN4N3NzeDN5aU5OUDlTby91UHVDRWlQem1nSVE1RmRRR1p1R1N0UTlvdEYxNlZJZVY5MkxpUXc9PQ==\r\nX-SES-DKIM-SIGNATURE: a=rsa-sha256; q=dns/txt; b=J0bz7UurAEFMM+CO3gPRRfCdhKq1ki4Z3uEFXVGvZyqyfA3C+/KTpLFhd831QsesSrgWlwAj+ewMYGv370OySxYDSF7zcQRgTA5dmP/cwVe67gtQ0RDwpO5BMAL3DcEgLjio2c9vxr/VW5sdjcpXtPLM9EG4cBD56jD7Xn/e1hE=; c=relaxed/simple; s=xplzuhjr4seloozmmorg6obznvt7ijlt; d=amazonses.com; t=1735317793; v=1; bh=D+grLzNXnel0ZuuRvozm+nFacrDnk4bo306ODvCsk60=; h=From:To:Cc:Bcc:Subject:Date:Message-ID:MIME-Version:Content-Type:X-SES-RECEIPT;\r\nReceived: by mail-vs1-f46.google.com with SMTP id ada2fe7eead31-4afdfefc6c1so2292745137.0\r\n        for <awake-pika@reply.humanlayer.dev>; Fri, 27 Dec 2024 08:43:13 -0800 (PST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;\r\n        d=humanlayer.dev; s=google; t=1735317792; x=1735922592; darn=reply.humanlayer.dev;\r\n        h=message-id:date:in-reply-to:to:subject:from:references:mime-version\r\n         :from:to:cc:subject:date:message-id:reply-to;\r\n        bh=LC1Ovx+8ysjnC2altqnrF9aoQA2YoxXkuU1zgYCNivI=;\r\n        b=oyab6h6+CisRwXN2zOjjfDIEIch+o7uUlJZHfMF3xYvYAefdKVv5GT51/x4d9IS4P7\r\n         ai3Xx12xkqeKCoEV9Le9rqCtksm6pUodF1+O496+tW4gDvaQsUtPb0NfENFmTEWAerWW\r\n         +igmIqwp7enwvnF3DFvuBEdbGurU9iaxbviZ1dkv7BP5SA2hq0zodFlZLEjEY7cd0uL+\r\n         S3SUOGphTnuKTSAd4SBWtpPZhSqjkPCgZ8OLK6LGl7XkWJTmw+ZjwiPai1acb9nHPtzE\r\n         OulwlKYLQ1f+OFRbSUjg/ai7NR8P957AxIdEGDSu2UwzkpSBdKaUrS5egeOYU442kagx\r\n         uwUQ==\r\nX-Google-DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;\r\n        d=1e100.net; s=20230601; t=1735317792; x=1735922592;\r\n        h=message-id:date:in-reply-to:to:subject:from:references:mime-version\r\n         :x-gm-message-state:from:to:cc:subject:date:message-id:reply-to;\r\n        bh=LC1Ovx+8ysjnC2altqnrF9aoQA2YoxXkuU1zgYCNivI=;\r\n        b=aWmvtSgFHu9Qi9OaoxNRXJlMdWcZdYKHID5/nNN9rDHqDyUNABtngr2aWuTkiofyHJ\r\n         4CJv939m70NgWOPyLtqWDXPLH7cROmeDgjmYVjWKqDGdTwCzlrSu5YhIPIkjnVt885Cr\r\n         Zj5vUK3nPPtsiHPSTQZe0M+GDPQSq0vPdLJTT4g6MFzPpotUZGbBBDEAxUv4iH+k3NnY\r\n         WvS487vj6V9HVRhTrUjEGFQV6RyQTyyHot/arCpyNRbKZh7PXiFrTSFiogPG2Lr8ip7f\r\n         H4X8Kiu88M1Ge8X+ldTLzknziQ4T+jNS+NvjS+5dqKfgXsqmL2Ne9Go1jHhVrwCOrGV6\r\n         k+tQ==\r\nX-Gm-Message-State: AOJu0YzSdQ+krH2DVp0S9jgQ1BjFbtlKRFEKtURSC7rcGuE7OOD9ceFP\r\n\tzoJFh9PE2/u3AY8Fld/fWnr+ax06xGTnfAzZKfYaGqPfc0j/+b2Taeb93h87zE1+ZN8HHgyQgM6\r\n\tr2yk=\r\nX-Gm-Gg: ASbGncuWH8AFAk6cWyCxjb78T0dZPdZ2zjnPohk4imoPcwpFvy6SuWPBE5ZfauoTs9R\r\n\tVLb/5hIvysI2ChZNQzMRWH8oV5sHdnoCU4eC5oPhs6ACZGvKGpax5tO/ZIbvHoR/PtkY7bV0Vmx\r\n\t7ecQ70ymLhIEUdEvIE7X5kjkgM30FnPbON0Oi6Gmxc8+z8nBJ6hn0K5G9tY/fjonpWCy7qWGG0i\r\n\tVhTyWaCft1Xr0DojQvf4vYleIhf+/MYfOodz6fk2U/1JdPuf4VAKk6a/sjguTno6zIybzwPhoMk\r\n\t235xij2N4tK0G50=\r\nX-Google-Smtp-Source: AGHT+IGCspu1tDK2ufTKRhS20ViIjxnCaYPDxONeEVRoxCiqiXObsswBhUZ/vN65GnP78u4LzjyuJg==\r\nX-Received: by 2002:a05:6102:3751:b0:4b2:73f7:5adf with SMTP id ada2fe7eead31-4b2cc351714mr22621331137.9.1735317792500;\r\n        Fri, 27 Dec 2024 08:43:12 -0800 (PST)\r\nReturn-Path: <dexter@humanlayer.dev>\r\nReceived: from localhost (0.92.231.35.bc.googleusercontent.com. [35.231.92.0])\r\n        by smtp.gmail.com with UTF8SMTPSA id ada2fe7eead31-4b2bfad130dsm3077425137.27.2024.12.27.08.43.12\r\n        for <awake-pika@reply.humanlayer.dev>\r\n        (version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256 bits=128/128);\r\n        Fri, 27 Dec 2024 08:43:12 -0800 (PST)\r\nMime-Version: 1.0\r\nX-Mailer: Superhuman Desktop (2024-12-18T20:41:51Z)\r\nX-Superhuman-ID: m56ze9lz.0b0c5cb1-1345-4577-9480-d94618e94e42\r\nReferences: <m56xwlo8.5f635e1e-c503-4cfc-a486-965dff344e22@we.are.superhuman.com>\r\nFrom: \"Dexter Horthy\" <dexter@humanlayer.dev>\r\nSubject: Re: new ticket\r\nTo: awake-pika@reply.humanlayer.dev\r\nX-Superhuman-Draft-ID: draft00ac1d2b8f00d96b\r\nIn-Reply-To: <m56xwlo8.5f635e1e-c503-4cfc-a486-965dff344e22@we.are.superhuman.com>\r\nDate: Fri, 27 Dec 2024 16:43:11 +0000\r\nMessage-ID: <m56ze7kj.7b0b12a7-08eb-4aaa-ace5-bae8077b2f83@we.are.superhuman.com>\r\nContent-Type: multipart/alternative;\r\n boundary=44d1dc62e9a8a63fb1a314bbd47d26c9cce95c67c54b3a03d8aceb3a4212\r\n\r\n--44d1dc62e9a8a63fb1a314bbd47d26c9cce95c67c54b3a03d8aceb3a4212\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nCan=C2=A0you make this?\r\n\r\nOn Fri, Dec 27, 2024 at 8:32 AM, Dexter Horthy < dexter@humanlayer.dev > wr=\r\note:\r\n\r\n>=20\r\n> Create=C2=A0an engineering ticket with high priority and labels bug,secur=\r\nity to\r\n> undo this recent terraform change, reinstating the=C2=A0more=C2=A0strict =\r\nand complex\r\n> dmarc policy\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> # aws_route53_record.humanlayer_dev_dmarc_gsuite will be updated in-place\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> ~ resource \"aws_route53_record\" \"humanlayer_dev_dmarc_gsuite\" {\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> id =3D \"Z018843525F5RGLOMXMCE__dmarc.humanlayer.dev_TXT\"\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> name =3D \" _dmarc. humanlayer. dev ( http://_dmarc.humanlayer.dev/ ) \"\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> ~ records =3D [\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> - \"v=3DDMARC1; p=3Dquarantine; sp=3Dreject; rua=3D mailto:dmarc-reports@ =\r\nmetalytics.\r\n> dev ( dmarc-reports@metalytics.dev ) ; ruf=3D mailto:dmarc-reports@ metal=\r\nytics.\r\n> dev ( dmarc-reports@metalytics.dev ) ; pct=3D100; aspf=3Ds; adkim=3Ds\",\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> + \"v=3DDMARC1; p=3Dnone; rua=3D mailto:dmarc-reports@ metalytics. dev (\r\n> dmarc-reports@metalytics.dev ) \",\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> ]\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> # (5 unchanged attributes hidden)\r\n>=20\r\n>=20\r\n>=20\r\n>=20\r\n> }\r\n>=20\r\n>=20\r\n>\r\n--44d1dc62e9a8a63fb1a314bbd47d26c9cce95c67c54b3a03d8aceb3a4212\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<html><head></head><body><div><div><div><div class=3D\"\">Can=C2=A0you make t=\r\nhis?</div></div><div><div style=3D\"display: none; border: 0px; width: 0px; =\r\nheight: 0px; overflow: hidden; visibility: hidden;\"><img src=3D\"https://r.s=\r\nuperhuman.com/Sm78QEfRumkIk6Z25oQiLBKpr1X9vQ2KzNLGBAhYwiSz5TIMVhEMAq83Ml4qq=\r\nIB5bvGeGyCiMS7mPAZICGNG-jNOUWwl0ZGHVn-gQFkvIWa4wDppMqRLCXcJxmYyG-eTIUJreqDg=\r\nrVTkGMQyzrRVjvRNZQmiSSB-W0cIVMjhObjIqBIzR7BJHKjZY4ww0za_oZT1.gif\" alt=3D\" \"=\r\n width=3D\"1\" height=3D\"0\" style=3D\"display: none; border: 0px; width: 0px; =\r\nheight: 0px; overflow: hidden; visibility: hidden;\"/><!--                  =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                                                           =\r\n                                --></div><br/><div class=3D\"gmail_signature=\r\n\"></div></div><br/><div><div class=3D\"gmail_quote\">On Fri, Dec 27, 2024 at =\r\n8:32 AM, Dexter Horthy <span dir=3D\"ltr\">&lt;<a href=3D\"mailto:dexter@human=\r\nlayer.dev\" target=3D\"_blank\">dexter@humanlayer.dev</a>&gt;</span> wrote:<br=\r\n/><blockquote class=3D\"gmail_quote\" style=3D\"margin:0 0 0 .8ex;border-left:=\r\n1px #ccc solid;padding-left:1ex\"><div class=3D\"gmail_extra\"><div class=3D\"g=\r\nmail_quote sh-color-black sh-color\"><div class=3D\"sh-color-black sh-color\">=\r\n<div class=3D\"sh-color-black sh-color\"><div class=3D\"sh-color-black sh-colo=\r\nr\">Create=C2=A0an engineering ticket with high priority and labels bug,secu=\r\nrity to undo this recent terraform change, reinstating the=C2=A0more=C2=A0s=\r\ntrict and complex dmarc policy<br/></div><div class=3D\"sh-color-black sh-co=\r\nlor\"><br/></div><p style=3D\"margin:0px;\" class=3D\"p1 sh-color-black sh-colo=\r\nr\"># aws_route53_record.humanlayer_dev_dmarc_gsuite will be updated in-plac=\r\ne<br/></p><p style=3D\"margin:0px;\" class=3D\"p1 sh-color-black sh-color\"><sp=\r\nan class=3D\"Apple-converted-space sh-color-black sh-color\">=C2=A0 </span>~ =\r\nresource &#34;aws_route53_record&#34; &#34;humanlayer_dev_dmarc_gsuite&#34;=\r\n {<br/></p><p style=3D\"margin:0px;\" class=3D\"p1 sh-color-black sh-color\"><s=\r\npan class=3D\"Apple-converted-space sh-color-black sh-color\">=C2=A0 =C2=A0 =\r\n=C2=A0 =C2=A0 </span>id <span class=3D\"Apple-converted-space sh-color-black=\r\n sh-color\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =\r\n=C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 </span>=3D &#34;Z018843525F5RGLOM=\r\nXMCE__dmarc.humanlayer.dev_TXT&#34;<br/></p><p style=3D\"margin:0px;\" class=\r\n=3D\"p1 sh-color-black sh-color\"><span class=3D\"Apple-converted-space sh-col=\r\nor-black sh-color\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 </span>name <span class=3D\"A=\r\npple-converted-space sh-color-black sh-color\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 =\r\n=C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 </spa=\r\nn>=3D &#34;<a class=3D\"sh-color-blue sh-color\" href=3D\"http://_dmarc.humanl=\r\nayer.dev/\" target=3D\"_blank\" rel=3D\"noopener noreferrer\">_dmarc.<wbr/>human=\r\nlayer.<wbr/>dev</a>&#34;<br/></p><p style=3D\"margin:0px;\" class=3D\"p1 sh-co=\r\nlor-black sh-color\"><span class=3D\"Apple-converted-space sh-color-black sh-=\r\ncolor\">=C2=A0 =C2=A0 =C2=A0 </span>~ records<span class=3D\"Apple-converted-=\r\nspace sh-color-black sh-color\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =\r\n=C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 </span>=3D [<br/></p><p st=\r\nyle=3D\"margin:0px;\" class=3D\"p1 sh-color-black sh-color\"><span class=3D\"App=\r\nle-converted-space sh-color-black sh-color\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=\r\n=A0 </span>- &#34;v=3DDMARC1; p=3Dquarantine; sp=3Dreject; rua=3D<a class=\r\n=3D\"sh-color-blue sh-color\" rel=3D\"noopener noreferrer\" href=3D\"mailto:dmar=\r\nc-reports@metalytics.dev\" target=3D\"_blank\">mailto:dmarc-reports@<wbr/>meta=\r\nlytics.<wbr/>dev</a>; ruf=3D<a class=3D\"sh-color-blue sh-color\" rel=3D\"noop=\r\nener noreferrer\" href=3D\"mailto:dmarc-reports@metalytics.dev\" target=3D\"_bl=\r\nank\">mailto:dmarc-reports@<wbr/>metalytics.<wbr/>dev</a>; pct=3D100; aspf=\r\n=3Ds; adkim=3Ds&#34;,<br/></p><p style=3D\"margin:0px;\" class=3D\"p1 sh-color=\r\n-black sh-color\"><span class=3D\"Apple-converted-space sh-color-black sh-col=\r\nor\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 =C2=A0 </span>+ &#34;v=3DDMARC1; p=3Dnone; =\r\nrua=3D<a class=3D\"sh-color-blue sh-color\" rel=3D\"noopener noreferrer\" href=\r\n=3D\"mailto:dmarc-reports@metalytics.dev\" target=3D\"_blank\">mailto:dmarc-rep=\r\norts@<wbr/>metalytics.<wbr/>dev</a>&#34;,<br/></p><p style=3D\"margin:0px;\" =\r\nclass=3D\"p1 sh-color-black sh-color\"><span class=3D\"Apple-converted-space s=\r\nh-color-black sh-color\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 </span>]<br/></p><p sty=\r\nle=3D\"margin:0px;\" class=3D\"p1 sh-color-black sh-color\"><span class=3D\"Appl=\r\ne-converted-space sh-color-black sh-color\">=C2=A0 =C2=A0 =C2=A0 =C2=A0 </sp=\r\nan># (5 unchanged attributes hidden)<br/></p><p style=3D\"margin:0px;\" class=\r\n=3D\"p1 sh-color-black sh-color\"><span class=3D\"Apple-converted-space sh-col=\r\nor-black sh-color\">=C2=A0 =C2=A0 </span>}</p></div></div></div></div></bloc=\r\nkquote></div></div><br/></div></div></body></html>\r\n--44d1dc62e9a8a63fb1a314bbd47d26c9cce95c67c54b3a03d8aceb3a4212--\r\n","is_test":null}
              </email_received>
              
      <create_issue>
                  Title: Undo recent Terraform change to reinstate stricter DMARC policy
                  Description: An issue has been raised to undo the recent Terraform change that modified the DMARC policy. The policy should be reinstated to its previous, stricter version with complex settings. The specifics of the change are detailed in the email from Dexter Horthy, where the resource 'aws_route53_record.humanlayer_dev_dmarc_gsuite' is mentioned to be updated in-place. The change involves adjusting the DMARC policy from 'p=none' back to a more secure policy.
                  Team ID: engineering_team_id
                  URL: Not created yet
      </create_issue>
              
      <error>
                  {"errors":[{"message":"Field \"labelsIds\" is not defined by type \"IssueCreateInput\". Did you mean \"labelIds\"?","locations":[{"line":8,"column":21}],"extensions":{"code":"GRAPHQL_VALIDATION_FAILED","type":"graphql error","userError":true,"meta":{}}}]}
      
      </error>
              
          
    "#
  }
}