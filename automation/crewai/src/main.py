from crewai import Agent, Crew, Task, Process
import yaml
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def load_yaml(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_agents(agent_cfg: dict):
    agents = {}
    for key, data in agent_cfg["agents"].items():
        agents[key] = Agent(
            role=data["role"],
            goal=data["goal"],
            backstory=data["backstory"],
            verbose=True,
            allow_delegation=True,
        )
    return agents


def run():
    agent_cfg = load_yaml(BASE_DIR / "config" / "agents.yaml")
    task_cfg = load_yaml(BASE_DIR / "config" / "tasks.yaml")
    agents = build_agents(agent_cfg)

    tasks = [
        Task(
            description=task_cfg["tasks"]["define_scope"]["description"],
            expected_output=task_cfg["tasks"]["define_scope"]["expected_output"],
            agent=agents["operations_manager"],
        ),
        Task(
            description=task_cfg["tasks"]["design_workflow"]["description"],
            expected_output=task_cfg["tasks"]["design_workflow"]["expected_output"],
            agent=agents["cultivation_specialist"],
        ),
        Task(
            description=task_cfg["tasks"]["design_financial_model"]["description"],
            expected_output=task_cfg["tasks"]["design_financial_model"]["expected_output"],
            agent=agents["financial_analyst"],
        ),
        Task(
            description=task_cfg["tasks"]["design_data_platform"]["description"],
            expected_output=task_cfg["tasks"]["design_data_platform"]["expected_output"],
            agent=agents["database_architect"],
        ),
        Task(
            description=task_cfg["tasks"]["implementation_breakdown"]["description"],
            expected_output=task_cfg["tasks"]["implementation_breakdown"]["expected_output"],
            agent=agents["full_stack_developer"],
        ),
        Task(
            description=task_cfg["tasks"]["quality_gate"]["description"],
            expected_output=task_cfg["tasks"]["quality_gate"]["expected_output"],
            agent=agents["qa_tester"],
        ),
    ]

    crew = Crew(
        agents=list(agents.values()),
        tasks=tasks,
        process=Process.sequential,
        verbose=True,
    )

    result = crew.kickoff()
    print("\n=== Crew Output ===\n")
    print(result)


if __name__ == "__main__":
    run()
