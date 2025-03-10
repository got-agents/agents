class RunCustomJavascriptCode {
  intent "run_custom_javascript_code"
  code string
  node_modules string[]
  environment_variables string[] @description(#"
    list of environment variables to forward to the code environment
  "#)
}

class ListEnvironmentVariablesAvailableToCode {
  intent "list_environment_variables_available_to_code" @description(#"
    returns a list of environment variables available to be passed to run_custom_javascript_code environment
  "#)
}

class AskLuneCodingQuesiton {
  intent "ask_lune_coding_question" @description(#"
    Lune is a helpful assistant that can help with coding questions.
    It is trained on upstream docs for vercel and github.
  "#)
  question string
  num_results int 
}


